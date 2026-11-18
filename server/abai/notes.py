"""Step 2a of the AI pipeline: the notes in a chosen stretch of one stem.

The app uploads one stem (the MP3 it got from step 1) with a start and end time. Basic Pitch
finds the notes in that stretch; onsets.refine() then moves every note's start to the exact
sample and says whether that start can be trusted to the sample ("exact").

Output: crop.mp3 (the stretch, for auditioning notes in the app) and notes.json (every note
with its pitch, exact start, cut point, length, loudness, attack type and a zoomed waveform of
the cut). All times are seconds from the start of the stretch.
"""

from __future__ import annotations

import json
import os
import tempfile

import numpy as np

from .common import SR, Report, db, decode, mono, write_wav
from .onsets import refine, zoom
from .stems import write_mp3

MAX_CROP_S = 120.0
MIN_CROP_S = 0.5
PRE_S = 0.2  # audio before the stretch, so a note right at its start has history to model
CROWD_S = 0.025  # another note this close: its attack could be mistaken for this one's
NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def note_name(midi: int) -> str:
    return f"{NAMES[midi % 12]}{midi // 12 - 1}"


def basic_pitch(y: np.ndarray) -> list[tuple[float, float, int, float]]:
    """(start, end, midi, amplitude) per note, sorted by start."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "crop.wav")
        write_wav(path, y)
        _, _, events = predict(
            path,
            ICASSP_2022_MODEL_PATH,
            onset_threshold=0.5,
            frame_threshold=0.3,
            minimum_note_length=60,
            multiple_pitch_bends=False,
        )
    notes = [(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in events]
    notes.sort()
    return notes


PARTIALS = (12, 19, 24, 28, 31, 36)  # octave, 12th, 2 octaves, ... above a played note


def drop_partials(notes: list[tuple[float, float, int, float]]) -> list[tuple[float, float, int, float]]:
    """Basic Pitch reports strong overtones (a low guitar string, organ, brass, bowed strings)
    as extra notes starting with the real one. Drop a note that sits an overtone above
    another starting within 70 ms, lasting as long, and at least 60 % as loud."""
    keep = []
    for n in notes:
        ghost = any(
            m is not n and abs(m[0] - n[0]) < 0.07 and (n[2] - m[2]) in PARTIALS and m[3] >= 0.6 * n[3] and m[1] >= n[1] - 0.15
            for m in notes
        )
        if not ghost:
            keep.append(n)
    return keep


def suggest_mode(x: np.ndarray, notes: list[dict]) -> dict:
    """Held (sustains while the key is down) or one-shot (plays out its own decay), from how
    the cleanest notes behave: attack type and how fast they fade while still sounding."""
    clean = [n for n in notes if n["exact"] or n["clear_db"] <= -10][:40]
    if not clean:
        clean = notes[:40]
    if not clean:
        return {"mode": "held", "why": "No notes found."}
    sharp = float(np.mean([n["sharp"] for n in clean]))
    drops = []
    for n in clean:
        a = int(n["_abs"] * SR)
        b = int((n["_abs"] + min(n["end"] - n["t"], 1.0)) * SR)
        if b - a < int(0.25 * SR):
            continue
        seg = x[a:b]
        w = int(0.05 * SR)
        lv = [float(np.sqrt(np.mean(seg[i : i + w] ** 2)) + 1e-9) for i in range(0, seg.size - w, w)]
        if len(lv) >= 4:
            peak = max(lv[:3])
            drops.append((db(peak) - db(lv[-1])) / ((len(lv) - 2) * 0.05))  # dB per second
    decay = float(np.median(drops)) if drops else 0.0
    if sharp >= 0.6 and decay >= 12.0:
        return {"mode": "oneshot", "why": f"Sharp attacks that fade on their own (about {decay:.0f} dB/s).", "decay_db_s": round(decay, 1), "sharp": round(sharp, 2)}
    if sharp < 0.4:
        return {"mode": "held", "why": "Notes swell in and hold their level.", "decay_db_s": round(decay, 1), "sharp": round(sharp, 2)}
    return {
        "mode": "held" if decay < 12.0 else "oneshot",
        "why": f"Mixed attacks; notes fade about {decay:.0f} dB/s while held.",
        "decay_db_s": round(decay, 1),
        "sharp": round(sharp, 2),
    }


def extract_notes(path: str, name: str, out: str, report: Report, params: dict) -> dict:
    os.makedirs(out, exist_ok=True)
    start = float(params.get("start", 0.0))
    end = float(params.get("end", 0.0))
    if not (end - start >= MIN_CROP_S):
        raise ValueError(f"Choose at least {MIN_CROP_S:g} s.")
    if end - start > MAX_CROP_S:
        raise ValueError(f"Choose at most {MAX_CROP_S:g} s.")
    report("decode", 0.05, "Reading the stem")
    x2 = decode(path, max_seconds=end + 0.5)
    total = x2.shape[1] / SR
    if start >= total - MIN_CROP_S:
        raise ValueError("That start is past the end of the stem.")
    end = min(end, total)
    x = mono(x2).astype(np.float32)
    a, b = int(start * SR), int(end * SR)
    crop = x2[:, a:b]

    report("notes", 0.15, "Finding notes (Basic Pitch)")
    lossy = not params.get("lossless")
    raw = basic_pitch(mono(crop))
    raw = drop_partials([r for r in raw if r[0] < (b - a) / SR - 0.02])

    report("onsets", 0.55, f"Finding the exact start of {len(raw)} notes")
    onsets = [r[0] for r in raw]
    notes: list[dict] = []
    found: list[tuple[float, float]] = []  # (Basic Pitch time, exact onset) of notes done so far
    for i, (s, e, midi, amp) in enumerate(raw):
        coarse = start + s
        crowded = any(abs(onsets[j] - s) < CROWD_S for j in range(max(0, i - 8), min(len(raw), i + 9)) if j != i)
        # Do not search back past an earlier note's attack (its own first 4 ms). Notes starting
        # together (within 25 ms: a chord) do not limit each other.
        before = [t for bp, t in found if bp < coarse - CROWD_S]
        earliest = max(max(0.0, start - PRE_S), min(max(before) + 0.004, coarse - 0.002) if before else 0.0)
        o = refine(x, SR, coarse, earliest=earliest, crowded=crowded, midi=midi)
        found.append((coarse, o.t))
        t = o.t - start
        notes.append(
            {
                "i": i,
                "midi": midi,
                "name": note_name(midi),
                "t": round(t, 6),
                "cut": round(o.cut - start, 6),
                "end": round(max(e, t + 0.03), 4),
                "vel": round(amp, 3),
                "coarse": round(s, 4),
                "shift_ms": round((o.t - coarse) * 1000, 3),
                "sharp": o.sharp,
                "exact": o.exact and not lossy,  # an MP3 smears attacks: never exact
                "crowded": crowded,
                "rise_ms": o.rise_ms,
                "snr_db": o.snr_db,
                "clear_db": float(o.clear_db),
                "wave": zoom(x, SR, o.t),
                "_abs": o.t,
            }
        )
        if i % 20 == 0:
            report("onsets", 0.55 + 0.3 * (i + 1) / max(1, len(raw)), f"Exact starts: {i + 1}/{len(raw)}")

    suggest = suggest_mode(x, notes)
    for n in notes:
        n.pop("_abs", None)
    notes.sort(key=lambda n: n["t"])

    report("save", 0.9, "Saving")
    write_mp3(os.path.join(out, "crop.mp3"), crop)
    keys = sorted({n["midi"] for n in notes})
    exact_keys = sorted({n["midi"] for n in notes if n["exact"]})
    doc = {
        "stem": params.get("stem", ""),
        "start": round(start, 4),
        "end": round(end, 4),
        "mode": params.get("mode", ""),
        "suggest": suggest,
        "notes": notes,
    }
    with open(os.path.join(out, "notes.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return {
        "kind": "notes",
        "name": name,
        "duration": round(end - start, 4),
        "stem": params.get("stem", ""),
        "start": round(start, 4),
        "end": round(end, 4),
        "mode": params.get("mode", ""),
        "suggest": suggest,
        # Read from the server's lossless copy of the stem (exact timing possible), or from the
        # app's MP3 (attacks smeared by several ms: nothing is marked exact).
        "audio": "lossless" if params.get("lossless") else "mp3",
        "count": len(notes),
        "exact": sum(1 for n in notes if n["exact"]),
        "keys": keys,
        "exact_keys": exact_keys,
        "styles": [],
        "sounds": [],
        "files": ["crop.mp3", "notes.json"],
    }
