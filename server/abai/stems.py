"""Step 1 of the AI pipeline, on its own: split a song into Demucs stems.

The app plays the stems in sync (mute / solo / blend, A/B against the original) so the
separation can be judged by ear before anything is built from it.
"""

from __future__ import annotations

import os
import subprocess

import numpy as np

from .common import SR, Report, db, decode, rms, separate

MODEL = "htdemucs_6s"
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


def extract_stems(path: str, name: str, out: str, report: Report) -> dict:
    os.makedirs(out, exist_ok=True)
    report("decode", 0.03, "Reading the song")
    x = decode(path, max_seconds=MAX_SECONDS)
    duration = x.shape[1] / SR
    report("separate", 0.1, f"Separating the instruments (Demucs {MODEL})")
    stems = separate(x, MODEL)
    report("encode", 0.75, "Saving the stems")
    song_rms = rms(x)
    total = sum(stems.values())
    residual = x - total
    # Demucs adds the song's DC offset back to every stem; that is not a difference you hear.
    residual = residual - residual.mean(axis=1, keepdims=True)
    tracks = []
    files = []
    for i, key in enumerate(("original",) + ORDER):
        y = x if key == "original" else stems[key]
        fname = f"{key}.mp3"
        write_mp3(os.path.join(out, fname), y)
        files.append(fname)
        level = rms(y)
        tracks.append(
            {
                "key": key,
                "label": LABELS[key],
                "file": fname,
                # How much of the song this stem carries, and its loudest point.
                "rms_db": round(float(db(level)), 1),
                "share_db": round(float(db(level / max(song_rms, 1e-9))), 1),
                "peak": round(float(np.abs(y).max()), 3),
            }
        )
        report("encode", 0.75 + 0.22 * (i + 1) / (len(ORDER) + 1), f"Saved {LABELS[key]}")
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
        "styles": [],
        "sounds": [],
        "files": files,
    }
