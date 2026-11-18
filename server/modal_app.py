"""ArrangerBox AI server on Modal.

    modal deploy modal_app.py          # API + GPU worker + hourly cleanup
    modal run modal_app.py::run_tests  # ground-truth pipeline tests on GPU
    modal run modal_app.py::make_demo  # demo songs served at /v1/demo/<name>

API (Authorization: Bearer <Supabase access token of a signed-in user>):
    POST   /v1/jobs                 multipart: file, kind=stems|notes|drums|sounds, name
                                    (notes: also start, end seconds, stem, mode=held|oneshot)
    GET    /v1/jobs/{id}            status, stage, progress, message, result manifest
    GET    /v1/jobs/{id}/files/{f}  a result file (manifest.json, .abstyle, .sfz, .wav)
    DELETE /v1/jobs/{id}
    GET    /v1/demo/{name}          demo song (demo_groove.mp3, demo_keys.mp3, demo_waltz.mp3)
Uploaded songs are deleted as soon as a job finishes; results expire after 24 hours. A stems job
also keeps lossless FLAC copies of the stems for 30 days (/data/stems/<job>), so a notes job can
pass source=<stems job id> instead of a file and get exact timing (MP3 smears attacks).
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
MAX_UPLOAD = 128 * 1024 * 1024  # a 10 min WAV is about 106 MB
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
NOTES_DAILY_LIMIT = 300


def _update(job_id: str, **fields) -> None:
    import db

    try:
        db.update_job(job_id, **fields)
    except Exception as exc:  # a progress update must never kill the job
        print(f"[{job_id}] status update failed: {exc}", flush=True)


@app.function(image=worker_image, gpu=GPUS, volumes={DATA: vol}, secrets=[secret], timeout=1800, memory=16384, max_containers=8)
def process(job_id: str) -> None:
    """GPU jobs: stems (Demucs), drums, sounds."""
    _process(job_id)


@app.function(image=worker_image, volumes={DATA: vol}, secrets=[secret], timeout=900, cpu=4, memory=8192, max_containers=8)
def process_cpu(job_id: str) -> None:
    """CPU jobs: notes (Basic Pitch runs fine without a GPU and starts faster)."""
    _process(job_id)


def _process(job_id: str) -> None:
    import shutil
    import sys
    import traceback

    sys.path.insert(0, "/root")
    import functools

    from abai.drums import extract_drum_style
    from abai.notes import extract_notes
    from abai.sounds import extract_sounds
    from abai.stems import extract_stems

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
        report("start", 0.01, "Server ready" if job["kind"] == "notes" else "GPU ready")
        params_path = f"{DATA}/jobs/{job_id}/in/params.json"
        params = json.load(open(params_path)) if os.path.exists(params_path) else {}
        notes = functools.partial(extract_notes, params=params)
        stems = functools.partial(extract_stems, keep_dir=f"{DATA}/stems/{job_id}")
        if job["kind"] == "stems":
            os.makedirs(f"{DATA}/stems/{job_id}", exist_ok=True)
            with open(f"{DATA}/stems/{job_id}/owner", "w") as fh:
                fh.write(job["user_id"])
        fn = {"drums": extract_drum_style, "stems": stems, "notes": notes}.get(job["kind"], extract_sounds)
        manifest = fn(job["input"], job.get("name") or "Song", out, report)
        manifest["sizes"] = {f: os.path.getsize(f"{DATA}/{f}" if f.startswith("lib/") else os.path.join(out, f)) for f in manifest["files"]}
        manifest["seconds"] = round(time.time() - started, 1)
        with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=1)
        if job["input"].startswith(f"{DATA}/jobs/{job_id}/in/"):
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
        if job["input"].startswith(f"{DATA}/jobs/{job_id}/in/"):  # never a kept lossless stem
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

    def kept_stem(source: str, stem: str, user: str) -> str | None:
        """The lossless copy of a stem from this user's stems job, if the server still has it."""
        if not re.fullmatch(r"[a-f0-9]{16}", source) or not re.fullmatch(r"[a-z]{3,12}", stem):
            return None
        folder = f"{DATA}/stems/{source}"
        for attempt in range(2):
            try:
                with open(f"{folder}/owner") as fh:
                    if fh.read().strip() != user:
                        return None
                path = f"{folder}/{stem}.flac"
                if os.path.exists(path):
                    return path
            except FileNotFoundError:
                pass
            if attempt == 0:
                with reload_lock:
                    try:
                        vol.reload()
                    except Exception as exc:
                        print("reload:", exc)
        return None

    @web.post("/v1/jobs")
    async def create(
        file: UploadFile | None = File(None),
        kind: str = Form("drums"),
        name: str = Form(""),
        start: float = Form(0.0),
        end: float = Form(0.0),
        stem: str = Form(""),
        mode: str = Form(""),
        source: str = Form(""),
        authorization: str | None = Header(None),
    ):
        user = auth(authorization)
        if kind not in ("stems", "notes", "drums", "sounds"):
            raise HTTPException(400, "kind must be stems, notes, drums or sounds")
        params = {}
        if kind == "notes":
            if not (0 <= start and end - start >= 0.5 and end - start <= 120.0):
                raise HTTPException(400, "Choose between 0.5 and 120 seconds of the stem.")
            if mode not in ("", "held", "oneshot"):
                raise HTTPException(400, "mode must be held or oneshot")
            params = {"start": start, "end": end, "stem": stem[:40], "mode": mode}
            kept = kept_stem(source, stem, user) if source else None
            if kept:
                params["lossless"] = kept
            elif file is None:
                raise HTTPException(410, "The server no longer has this song's lossless stems. Send the stem file.")
            # Finding notes is quick; it has its own, larger allowance.
            if db.jobs_today(user, notes=True) >= NOTES_DAILY_LIMIT:
                raise HTTPException(429, f"Daily limit reached ({NOTES_DAILY_LIMIT} note searches per 24 hours). Try again later.")
        elif db.jobs_today(user) >= daily_limit:
            raise HTTPException(429, f"Daily limit reached ({daily_limit} songs per 24 hours). Try again later.")
        job_id = uuid.uuid4().hex[:16]
        folder = f"{DATA}/jobs/{job_id}/in"
        os.makedirs(folder, exist_ok=True)
        size = 0
        if params.get("lossless"):
            path = params["lossless"]  # read in place; the job never deletes it
        else:
            if file is None:
                raise HTTPException(400, "No file.")
            ext = os.path.splitext(file.filename or "")[1].lower()
            if ext not in AUDIO_EXT:
                ext = ".audio"
            path = f"{folder}/song{ext}"
            with open(path, "wb") as fh:
                while chunk := await file.read(1 << 20):
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        fh.close()
                        os.remove(path)
                        raise HTTPException(413, "The file is larger than 128 MB.")
                    fh.write(chunk)
            if size < 1024:
                raise HTTPException(400, "The file is empty.")
        if params:
            with open(f"{folder}/params.json", "w") as fh:
                json.dump(params, fh)
        vol.commit()
        title = (name or os.path.splitext((file.filename if file else "") or "Song")[0]).strip()[:60] or "Song"
        db.insert_job(
            {
                "id": job_id,
                "user_id": user,
                "kind": kind,
                "name": title,
                "status": "queued",
                "stage": "queued",
                "progress": 0.0,
                "message": "Waiting for the server" if kind == "notes" else "Waiting for a GPU",
                "bytes": size,
                "input_path": path,
            }
        )
        (process_cpu if kind == "notes" else process).spawn(job_id)
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
        kind = {".json": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".sfz": "text/plain", ".abstyle": "text/plain"}
        return Response(data, media_type=kind.get(os.path.splitext(name)[1], "application/octet-stream"))

    @web.get("/v1/library/{inst}/{name}")
    def library_file(inst: str, name: str, authorization: str | None = Header(None)):
        """A shared library sample (a song's .sfz points at these; the app keeps them)."""
        auth(authorization)
        if not re.fullmatch(r"[a-z0-9_]{1,40}", inst) or not re.fullmatch(r"[a-z0-9_]{1,60}\.wav", name):
            raise HTTPException(400, "bad file name")
        try:
            data = read_file(f"{DATA}/lib/{inst}/{name}")
        except FileNotFoundError:
            raise HTTPException(404, "No such library file.")
        return Response(data, media_type="audio/wav", headers={"Cache-Control": "private, max-age=31536000, immutable"})

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
    # Lossless stems kept for exact note timing (abai/stems.py KEEP_DAYS).
    root = f"{DATA}/stems"
    if os.path.isdir(root):
        import shutil

        for job_id in os.listdir(root):
            path = os.path.join(root, job_id)
            if now - os.path.getmtime(path) > 30 * 86400:
                shutil.rmtree(path, ignore_errors=True)
    vol.commit()


@app.function(image=worker_image, timeout=1800, cpu=4, memory=8192)
def notes_selftest(only: str = "", debug: bool = False, lossless: bool = False, scenes: str = "", compare: bool = False) -> list:
    """Step 2a end to end on real instrument sounds with sample-exact truth (see notes_selftest.py)."""
    import sys

    sys.path.insert(0, "/root")
    if debug:
        os.environ["AB_DEBUG"] = "1"
        os.environ["AB_DIAG"] = "1"
    from abai.notes_selftest import run

    return run(only=only, lossless_too=lossless, scenes=scenes, compare=compare)


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


@app.function(image=worker_image, volumes={DATA: vol}, timeout=3600, memory=16384, cpu=8)
def build_library() -> str:
    """Download the openly licensed sample libraries and prepare them for the app
    (once; again whenever abai.library.LIB_VERSION changes)."""
    import shutil
    import sys

    sys.path.insert(0, "/root")
    from abai.library import build_library as build

    shutil.rmtree(f"{DATA}/lib", ignore_errors=True)
    index = build("/tmp/libsrc", f"{DATA}/lib")
    vol.commit()
    return json.dumps({k: [v["name"], len(v["zones"]), round(v["bytes"] / 1e6, 1)] for k, v in index["instruments"].items()})


@app.local_entrypoint()
def library():
    print(build_library.remote())


@app.function(image=worker_image, gpu=GPUS, volumes={DATA: vol}, timeout=1800, memory=16384)
def run_tests(only: str = "", capture: int = 1) -> str:
    """Render ground-truth songs, run both pipelines, score them. Returns a JSON report."""
    import sys
    import traceback

    sys.path.insert(0, "/root")
    from abai.drums import extract_drum_style
    from abai.evaluate import check_drums, check_sounds, check_timbre
    import abai.sounds
    from abai.sounds import extract_sounds
    from abai.testsong import make_groove_song, make_keys_song

    abai.sounds.CAPTURE = bool(capture)
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
def tests(only: str = "", capture: int = 1):
    rep = json.loads(run_tests.remote(only, capture))
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
