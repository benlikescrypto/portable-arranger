"""Step 1 of the AI pipeline, on its own: split a song into Demucs stems.

The app plays the stems in sync (mute / solo / blend, A/B against the original) so the
separation can be judged by ear before anything is built from it.
"""

from __future__ import annotations

import os
import subprocess

import numpy as np

from .common import SR, Report, db, decode, rms, separate

# htdemucs_ft: the default Demucs v4 (htdemucs, 9.0 dB SDR on MUSDB18-HQ) fine-tuned once per
# stem, so each of vocals, drums, bass and other comes from its own specialist model. The
# Demucs authors rate it a bit better than htdemucs at four times the compute (well under a
# minute per song on the GPU). htdemucs_6s adds piano and guitar, but its piano bleeds badly
# ("not working great", Demucs README), so the app sticks to four clean stems.
MODEL = "htdemucs_ft"
MAX_SECONDS = 600.0  # the app holds every track in RAM: about 70 MB per minute of song
BITRATE = "320k"
LABELS = {
    "original": "Original",
    "vocals": "Vocals",
    "drums": "Drums",
    "bass": "Bass",
    "piano": "Piano",
    "guitar": "Guitar",
    "other": "Other",
}
# Display order; a model's stems outside this list follow in its own order.
ORDER = ("vocals", "drums", "bass", "piano", "guitar", "other")


def write_mp3(path: str, x: np.ndarray) -> None:
    """(2, n) float32 at SR -> MP3. Every file goes through the same encoder settings so
    the stems and the original stay sample-aligned after decoding."""
    data = np.ascontiguousarray(x.T.astype(np.float32)).tobytes()
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-"]
    cmd += ["-c:a", "libmp3lame", "-b:a", BITRATE, path]
    proc = subprocess.run(cmd, input=data, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError("MP3 encode failed: " + proc.stderr.decode(errors="replace")[-300:])


LOSSLESS_EXT = {".wav", ".flac", ".aif", ".aiff"}
KEEP_DAYS = 30  # lossless copies kept on the server for exact note timing (step 2)


def write_flac(path: str, x: np.ndarray) -> None:
    import soundfile as sf

    sf.write(path, np.clip(x.T, -1.0, 1.0), SR, format="FLAC", subtype="PCM_24")  # Demucs float output, 24-bit: nothing audible or measurable lost


def extract_stems(path: str, name: str, out: str, report: Report, keep_dir: str | None = None) -> dict:
    """keep_dir: also save every track there as lossless FLAC (MP3 smears attacks by several
    ms, so exact note timing in step 2 reads these instead of the app's MP3s)."""
    os.makedirs(out, exist_ok=True)
    if keep_dir:
        os.makedirs(keep_dir, exist_ok=True)
    report("decode", 0.03, "Reading the song")
    x = decode(path, max_seconds=MAX_SECONDS)
    duration = x.shape[1] / SR
    report("separate", 0.1, f"Separating vocals, drums, bass and other (Demucs {MODEL})")
    stems = separate(x, MODEL)
    report("encode", 0.75, "Saving the stems")
    song_rms = rms(x)
    total = sum(stems.values())
    residual = x - total
    # Demucs adds the song's DC offset back to every stem; that is not a difference you hear.
    residual = residual - residual.mean(axis=1, keepdims=True)
    tracks = []
    files = []
    order = [k for k in ORDER if k in stems] + [k for k in stems if k not in ORDER]
    for i, key in enumerate(["original"] + order):
        y = x if key == "original" else stems[key]
        fname = f"{key}.mp3"
        write_mp3(os.path.join(out, fname), y)
        if keep_dir:
            write_flac(os.path.join(keep_dir, f"{key}.flac"), y)
        files.append(fname)
        level = rms(y)
        tracks.append(
            {
                "key": key,
                "label": LABELS.get(key, key.title()),
                "file": fname,
                # How much of the song this stem carries, and its loudest point.
                "rms_db": round(float(db(level)), 1),
                "share_db": round(float(db(level / max(song_rms, 1e-9))), 1),
                "peak": round(float(np.abs(y).max()), 3),
            }
        )
        report("encode", 0.75 + 0.22 * (i + 1) / (len(order) + 1), f"Saved {LABELS.get(key, key)}")
    return {
        "kind": "stems",
        "name": name,
        "duration": round(duration, 3),
        "cut": duration >= MAX_SECONDS - 0.5,
        "model": MODEL,
        "stems": tracks,
        # What the stems miss when added back together (lower is better; Demucs is
        # usually below -30 dB).
        "residual_db": round(float(db(rms(residual) / max(song_rms, 1e-9))), 1),
        # Exact note timing needs a lossless song: an MP3 upload already smears attacks.
        "source_lossless": os.path.splitext(path)[1].lower() in LOSSLESS_EXT,
        "lossless_days": KEEP_DAYS if keep_dir else 0,
        "styles": [],
        "sounds": [],
        "files": files,
    }
