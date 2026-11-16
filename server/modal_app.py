"""ArrangerBox AI server on Modal.

    modal deploy modal_app.py          # API + GPU worker + hourly cleanup
    modal run modal_app.py::run_tests  # ground-truth pipeline tests on GPU
    modal run modal_app.py::make_demo  # demo songs served at /v1/demo/<name>

API (Authorization: Bearer <Supabase access token of a signed-in user>):
    POST   /v1/jobs                 multipart: file, kind=drums|sounds, name
    GET    /v1/jobs/{id}            status, stage, progress, message, result manifest
    GET    /v1/jobs/{id}/files/{f}  a result file (manifest.json, .abstyle, .sfz, .wav)
    DELETE /v1/jobs/{id}
    GET    /v1/demo/{name}          demo song (demo_groove.mp3, demo_keys.mp3, demo_waltz.mp3)
Uploaded songs are deleted as soon as a job finishes; results expire after 24 hours.
Job state lives in Supabase (public.ai_jobs, see server/db.py); users only see their own jobs.
Modal secret "arrangerbox-ai": SUPABASE_URL, SUPABASE_SECRET_KEY, optional AI_DAILY_LIMIT.
"""


import json
import os
import time
from pathlib import Path

import modal

from images import SF2, gpu_image, web_image

HERE = Path(__file__).parent
DATA = "/data"
RESULT_TTL_S = 24 * 3600
GPUS = ["L4", "A10G", "L40S", "T4"]  # first free one wins
MAX_UPLOAD = 80 * 1024 * 1024
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aif", ".aiff", ".mp4", ".opus", ".wma"}

app = modal.App("arrangerbox-ai")
vol = modal.Volume.from_name("arrangerbox-ai-data", create_if_missing=True)
secret = modal.Secret.from_name("arrangerbox-ai")

# Deployed containers import this file, so they need images.py (and the pipeline) too.
worker_image = (
    gpu_image.add_local_python_source("images", "db")
    .add_local_dir(HERE / "abai", "/root/abai")
    .add_local_file(SF2, "/assets/GeneralUser-GS.sf2")
)
api_image = web_image.add_local_python_source("images", "db")
DAILY_LIMIT_DEFAULT = 20


def _update(job_id: str, **fields) -> None:
    import db

    try:
        db.update_job(job_id, **fields)
    except Exception as exc:  # a progress update must never kill the job
        print(f"[{job_id}] status update failed: {exc}", flush=True)


@app.function(image=worker_image, gpu=GPUS, volumes={DATA: vol}, secrets=[secret], timeout=1800, memory=16384, max_containers=8)
def process(job_id: str) -> None:
    import shutil
    import sys
    import traceback

    sys.path.insert(0, "/root")
    from abai.drums import extract_drum_style
    from abai.sounds import extract_sounds

    import db

    vol.reload()
    job = db.get_job(job_id)
    if not job:
        return
    job["input"] = job["input_path"]
    out = f"{DATA}/jobs/{job_id}/out"
    started = time.time()

    def report(stage: str, frac: float, msg: str = "") -> None:
        _update(job_id, status="running", stage=stage, progress=round(float(frac), 3), message=msg)
        print(f"[{job_id}] {stage} {frac:.2f} {msg}", flush=True)

    try:
        report("start", 0.01, "GPU ready")
        fn = extract_drum_style if job["kind"] == "drums" else extract_sounds
        manifest = fn(job["input"], job.get("name") or "Song", out, report)
        manifest["sizes"] = {f: os.path.getsize(os.path.join(out, f)) for f in manifest["files"]}
        manifest["seconds"] = round(time.time() - started, 1)
        with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=1)
        try:
            os.remove(job["input"])
        except OSError:
            pass
        vol.commit()  # files must be visible before the app sees "done"
        _update(job_id, status="done", stage="done", progress=1.0, result=manifest)
    except Exception as exc:
        traceback.print_exc()
        msg = str(exc) if isinstance(exc, ValueError) else f"Processing failed ({type(exc).__name__})."
        _update(job_id, status="error", stage="error", message=msg)
    finally:
        try:
            os.remove(job["input"])
        except OSError:
            pass
        shutil.rmtree(f"{DATA}/jobs/{job_id}/in", ignore_errors=True)
        vol.commit()


@app.function(image=api_image, volumes={DATA: vol}, secrets=[secret], scaledown_window=300)
@modal.concurrent(max_inputs=40)
@modal.asgi_app()
def api():
    import re
    import threading
    import uuid

    from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
    from fastapi.responses import Response

    import db

    web = FastAPI(title="ArrangerBox AI", docs_url=None, redoc_url=None)
    daily_limit = int(os.environ.get("AI_DAILY_LIMIT") or DAILY_LIMIT_DEFAULT)
    reload_lock = threading.Lock()

    def auth(authorization: str | None) -> str:
        user = db.verify_user(authorization)
        if not user:
            raise HTTPException(401, "Sign in to use ArrangerBox AI.")
        return user

    def own_job(job_id: str, user: str) -> dict:
        if not re.fullmatch(r"[a-f0-9]{16}", job_id):
            raise HTTPException(404, "No such job.")
        job = db.get_job(job_id)
        if not job or job["user_id"] != user:
            raise HTTPException(404, "No such job (results expire after 24 hours).")
        return job

    def read_file(path: str) -> bytes:
        for attempt in range(4):
            try:
                with open(path, "rb") as fh:
                    return fh.read()
            except FileNotFoundError:
                if attempt == 3:
                    raise
                with reload_lock:
                    try:
                        vol.reload()
                    except Exception as exc:  # files open in another request
                        print("reload retry:", exc)
                        time.sleep(0.3)
        raise FileNotFoundError(path)

    @web.get("/v1/health")
    def health():
        return {"ok": True, "version": 1}

    @web.post("/v1/jobs")
    async def create(
        file: UploadFile = File(...),
        kind: str = Form("drums"),
        name: str = Form(""),
        authorization: str | None = Header(None),
    ):
        user = auth(authorization)
        if kind not in ("drums", "sounds"):
            raise HTTPException(400, "kind must be drums or sounds")
        if db.jobs_today(user) >= daily_limit:
            raise HTTPException(429, f"Daily limit reached ({daily_limit} songs per 24 hours). Try again later.")
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in AUDIO_EXT:
            ext = ".audio"
        job_id = uuid.uuid4().hex[:16]
        folder = f"{DATA}/jobs/{job_id}/in"
        os.makedirs(folder, exist_ok=True)
        path = f"{folder}/song{ext}"
        size = 0
        with open(path, "wb") as fh:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    fh.close()
                    os.remove(path)
                    raise HTTPException(413, "The file is larger than 80 MB.")
                fh.write(chunk)
        if size < 1024:
            raise HTTPException(400, "The file is empty.")
        vol.commit()
        title = (name or os.path.splitext(file.filename or "Song")[0]).strip()[:60] or "Song"
        db.insert_job(
            {
                "id": job_id,
                "user_id": user,
                "kind": kind,
                "name": title,
                "status": "queued",
                "stage": "queued",
                "progress": 0.0,
                "message": "Waiting for a GPU",
                "bytes": size,
                "input_path": path,
            }
        )
        process.spawn(job_id)
        return {"id": job_id, "status": "queued"}

    @web.get("/v1/jobs/{job_id}")
    def status(job_id: str, authorization: str | None = Header(None)):
        return db.to_api(own_job(job_id, auth(authorization)))

    @web.get("/v1/jobs/{job_id}/files/{name}")
    def result_file(job_id: str, name: str, authorization: str | None = Header(None)):
        user = auth(authorization)
        if not re.fullmatch(r"[A-Za-z0-9_.\-]{1,96}", name) or ".." in name:
            raise HTTPException(400, "bad file name")
        job = own_job(job_id, user)
        if job.get("status") != "done":
            raise HTTPException(404, "No finished job with that id.")
        if name != "manifest.json" and name not in job["result"]["files"]:
            raise HTTPException(404, "Not a file of this job.")
        try:
            data = read_file(f"{DATA}/jobs/{job_id}/out/{name}")
        except FileNotFoundError:
            raise HTTPException(404, "File is gone.")
        kind = {".json": "application/json", ".wav": "audio/wav", ".sfz": "text/plain", ".abstyle": "text/plain"}
        return Response(data, media_type=kind.get(os.path.splitext(name)[1], "application/octet-stream"))

    @web.delete("/v1/jobs/{job_id}")
    def delete(job_id: str, authorization: str | None = Header(None)):
        own_job(job_id, auth(authorization))
        remove_job(job_id)
        return {"ok": True}

    @web.get("/v1/demo/{name}")
    def demo(name: str, authorization: str | None = Header(None)):
        auth(authorization)
        if not re.fullmatch(r"demo_[a-z]+\.mp3", name):
            raise HTTPException(404, "No such demo.")
        try:
            data = read_file(f"{DATA}/demo/{name}")
        except FileNotFoundError:
            raise HTTPException(404, "No such demo.")
        return Response(data, media_type="audio/mpeg")

    return web


def remove_job(job_id: str) -> None:
    import shutil

    import db

    shutil.rmtree(f"{DATA}/jobs/{job_id}", ignore_errors=True)
    db.delete_job(job_id)
    vol.commit()


@app.function(image=api_image, volumes={DATA: vol}, secrets=[secret], schedule=modal.Period(hours=1))
def cleanup() -> None:
    import db

    now = time.time()
    for job_id in db.expired_jobs(RESULT_TTL_S):
        remove_job(job_id)
    known = db.all_job_ids()
    root = f"{DATA}/jobs"
    if os.path.isdir(root):
        for job_id in os.listdir(root):
            if job_id not in known:
                path = os.path.join(root, job_id)
                if now - os.path.getmtime(path) > RESULT_TTL_S:
                    import shutil

                    shutil.rmtree(path, ignore_errors=True)
    vol.commit()


@app.function(image=worker_image, volumes={DATA: vol}, timeout=900)
def make_demo() -> str:
    import shutil
    import sys

    sys.path.insert(0, "/root")
    from abai.testsong import make_groove_song, make_keys_song

    os.makedirs(f"{DATA}/demo", exist_ok=True)
    made = []
    for kind in ("groove", "waltz"):
        t = make_groove_song("pop" if kind == "groove" else "waltz", "/tmp", seed=7)
        shutil.copy(t["file"], f"{DATA}/demo/demo_{kind}.mp3")
        made.append(f"demo_{kind}.mp3")
    t = make_keys_song("/tmp", seed=7)
    shutil.copy(t["file"], f"{DATA}/demo/demo_keys.mp3")
    made.append("demo_keys.mp3")
    vol.commit()
    return ", ".join(made)


@app.function(image=worker_image, gpu=GPUS, timeout=1800, memory=16384)
def run_tests(only: str = "") -> str:
    """Render ground-truth songs, run both pipelines, score them. Returns a JSON report."""
    import sys
    import traceback

    sys.path.insert(0, "/root")
    from abai.drums import extract_drum_style
    from abai.evaluate import check_drums, check_sounds, check_timbre
    from abai.sounds import extract_sounds
    from abai.testsong import make_groove_song, make_keys_song

    report: dict = {}
    cases = [c for c in ("pop", "waltz", "keys") if not only or c in only.split(",")]
    for case in cases:
        t0 = time.time()
        try:
            if case == "keys":
                truth = make_keys_song("/tmp")
                man = extract_sounds(truth["file"], "Keys Test", f"/tmp/out_{case}")
                checks = check_sounds(truth, man, f"/tmp/out_{case}") + check_timbre(truth, man, f"/tmp/out_{case}", "/assets/GeneralUser-GS.sf2")
            else:
                truth = make_groove_song(case, "/tmp")
                man = extract_drum_style(truth["file"], f"{case.title()} Test", f"/tmp/out_{case}")
                checks = check_drums(truth, man, f"/tmp/out_{case}")
            summary = {k: man[k] for k in ("bpm", "meter", "sections", "elements", "fills", "timeline") if k in man}
            if "sounds" in man:
                summary["sounds"] = [{k: v for k, v in s.items() if k != "zones"} | {"roots": [(z["root"], z.get("at")) for z in s["zones"]]} for s in man["sounds"]]
            report[case] = {
                "seconds": round(time.time() - t0, 1),
                "checks": [[n, bool(ok), d] for n, ok, d in checks],
                "summary": summary,
            }
        except Exception:
            report[case] = {"error": traceback.format_exc()}
    return json.dumps(report, default=str)


@app.local_entrypoint()
def tests(only: str = ""):
    rep = json.loads(run_tests.remote(only))
    failed = 0
    for case, r in rep.items():
        print(f"\n=== {case} ({r.get('seconds', '?')} s)")
        if "error" in r:
            print(r["error"])
            failed += 1
            continue
        for name, ok, detail in r["checks"]:
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
            failed += 0 if ok else 1
        print("  summary:", json.dumps(r["summary"])[:3000])
    print(f"\n{failed} failed")
