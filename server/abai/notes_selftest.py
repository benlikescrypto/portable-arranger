"""End-to-end check of step 2a with real instrument sounds and sample-exact truth.

FluidSynth only starts notes on 64-sample block boundaries, so a rendered phrase has no exact
truth. Instead every note is rendered on its own (GeneralUser GS, float output), its first
sample above the near-silence before it is its true start, and the phrase is assembled here
at known sample positions. The phrase then goes through exactly what a stem
goes through: 320 kbps MP3, decode, Basic Pitch, onsets.refine().

Run:  modal run modal_app.py::notes_selftest
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import tempfile

import mido
import numpy as np

from .common import SR, write_wav
from .notes import extract_notes
from .stems import write_mp3

SF2 = "/assets/GeneralUser-GS.sf2"

# (label, GM program, pitch range, note length range s, expected mode)
INSTRUMENTS = [
    ("Piano", 0, (45, 84), (0.25, 0.9), "oneshot"),
    ("Marimba", 12, (55, 88), (0.15, 0.4), "oneshot"),
    ("Nylon guitar", 24, (45, 76), (0.25, 0.8), "oneshot"),
    ("E-piano", 4, (48, 84), (0.25, 0.8), "oneshot"),
    ("Strings", 48, (48, 79), (0.5, 1.2), "held"),
]


def render_note(program: int, midi: int, vel: int, dur_s: float, tmp: str) -> np.ndarray:
    """One note, mono float, trimmed so index 0 is its first sample."""
    import soundfile as sf

    mid = mido.MidiFile(ticks_per_beat=480)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))  # 120 bpm: 960 ticks/s
    tr.append(mido.Message("program_change", program=program, time=0))
    tr.append(mido.Message("note_on", note=midi, velocity=vel, time=96))
    tr.append(mido.Message("note_off", note=midi, velocity=0, time=int(dur_s * 960)))
    tr.append(mido.MetaMessage("end_of_track", time=int(2.5 * 960)))
    mp, wp = os.path.join(tmp, "n.mid"), os.path.join(tmp, "n.wav")
    mid.save(mp)
    subprocess.run(
        ["fluidsynth", "-ni", "-q", "-g", "0.6", "-r", str(SR), "-o", "audio.file.format=float", "-F", wp, SF2, mp],
        check=True,
        capture_output=True,
    )
    y, sr = sf.read(wp, dtype="float32", always_2d=True)
    assert sr == SR
    y = y.mean(1)
    # The note-on is at 0.1 s; FluidSynth starts it on a 64-sample block boundary near there.
    # Whatever it outputs before (tiny, not exactly zero) sets the floor; the first sample
    # clearly above it is the true start.
    on = int(0.1 * SR)
    floor = float(np.max(np.abs(y[: on - 256]))) if on > 512 else 0.0
    nz = np.nonzero(np.abs(y) > max(floor * 4.0, 1e-7))[0]
    if not nz.size:
        return np.zeros(0, np.float32)
    first = int(nz[0])
    if abs(first - on) > 256:
        raise RuntimeError(f"note {midi} started at sample {first}, expected near {on} (floor {floor:.2e})")
    y = y[first:]
    # Drop the long silent tail.
    loud = np.nonzero(np.abs(y) > 1e-5)[0]
    return y[: int(loud[-1]) + 1] if loud.size else y


def phrase(program: int, lo: int, hi: int, lens: tuple[float, float], count: int, seed: int, tmp: str, apart: bool = False, fast: bool = False):
    """apart=False: notes overlap and ring into each other (normal playing). apart=True: each
    note has died away before the next (the kind of take step 2b samples). fast=True: 8-16
    notes a second, mostly the same key struck again (Basic Pitch used to merge those)."""
    rng = random.Random(seed)
    cache: dict[tuple[int, int, int], np.ndarray] = {}
    events = []
    t = 0.6
    for _ in range(count):
        midi = rng.randint(lo, hi)
        if fast and events and rng.random() < 0.6:
            midi = events[-1][1]  # the same key again
        vel = rng.choice((50, 70, 90, 110))
        gap = 1.0 / rng.uniform(8, 16) if fast else 0.0
        dur = round(max(0.04, gap * 0.9), 3) if fast else round(rng.uniform(*lens), 2)
        key = (midi, vel, int(dur * 1000))
        if key not in cache:
            cache[key] = render_note(program, midi, vel, dur, tmp)
        events.append((int(round(t * SR)), midi, cache[key]))
        if fast:
            t += gap
        else:
            t += cache[key].size / SR + rng.uniform(0.05, 0.3) if apart else rng.uniform(0.18, 0.6)
    n = events[-1][0] + max(e[2].size for e in events) + SR
    x = np.zeros(n, np.float32)
    for pos, _m, y in events:
        x[pos : pos + y.size] += y
    x *= 0.5 / max(1e-9, float(np.abs(x).max()))
    return x, [(pos, m) for pos, m, _ in events]


def diag(x: np.ndarray, truth) -> None:
    """Re-strike evidence at real re-strikes and at points inside held notes that are not."""
    from .notes import basic_pitch, restrike_rise

    _, onset, ft = basic_pitch(x)

    def act(t, m):
        i = int(np.searchsorted(ft, t))
        return float(onset[max(0, i - 1) : i + 2, m - 21].max(initial=0.0))

    yes, no = [], []
    for i, (p, m) in enumerate(truth):
        if i and truth[i - 1][1] == m:
            T = p / SR
            yes.append((round(restrike_rise(x, SR, m, T), 1), round(act(T, m), 2)))
            prevT = truth[i - 1][0] / SR
            # A point inside the earlier note, between its attack and this one: no strike there.
            if T - prevT > 0.075:
                t2 = prevT + 0.5 * (T - prevT)
                no.append((round(restrike_rise(x, SR, m, t2), 1), round(act(t2, m), 2)))
    print("DIAG yes", sorted(yes))
    print("DIAG no ", sorted(no))


def check(label: str, x: np.ndarray, truth, expect_mode: str, tmp: str, lossless: bool, scene: str, legacy: bool = False) -> dict:
    path = os.path.join(tmp, "stem.wav" if lossless else "stem.mp3")
    stereo = np.stack([x, x])
    if lossless:
        write_wav(path, stereo)
    else:
        write_mp3(path, stereo)
    start = 0.4
    end = min(x.size / SR - 0.2, start + 115.0)
    out = os.path.join(tmp, "out")
    params = {"start": start, "end": end, "stem": label, "mode": "", "_legacy": legacy, "_debug": True}
    if lossless:
        params["lossless"] = path  # as for a stem the server kept losslessly
    if os.environ.get("AB_DIAG") and lossless and not legacy:
        diag(x, truth)
    man = extract_notes(path, label, out, lambda *a: None, params)
    doc = json.load(open(os.path.join(out, "notes.json")))
    found = doc["notes"]
    if os.environ.get("AB_DEBUG") and scene == "apart":
        for p, m in truth[:10]:
            T = p / SR - start
            near = [n for n in found if abs(n["coarse"] - T) < 0.08]
            print("TRUTH", round(T, 4), m, "|", [(n["midi"], round((n["t"] - T) * 1000, 2), round((n["coarse"] - T) * 1000, 1), n["sharp"], n["exact"], n["clear_db"], n["crowded"]) for n in near])
    used = set()
    errs, exact_errs, cut_late, approx = [], [], 0, []
    matched = 0
    repeats = repeats_found = 0
    for idx, (pos, m) in enumerate(truth):
        is_repeat = idx > 0 and truth[idx - 1][1] == m
        T = pos / SR - start
        best = None
        for k, nn in enumerate(found):
            if k in used or nn["midi"] != m:
                continue
            d = min(abs(nn["coarse"] - T), abs(nn["t"] - T))
            if d < (0.04 if scene == "fast" else 0.08) and (best is None or d < best[0]):
                best = (d, k)
        repeats += is_repeat
        if best is None:
            continue
        repeats_found += is_repeat
        used.add(best[1])
        nn = found[best[1]]
        matched += 1
        e = (nn["t"] - T) * 1000
        errs.append(e)
        if nn["exact"]:
            exact_errs.append(e)
        else:
            approx.append(e)
        if nn["cut"] > T + 1e-6:
            cut_late += 1
    a = np.abs(np.array(exact_errs)) if exact_errs else np.zeros(0)
    from collections import Counter

    extras = Counter(f"{n['via']}{'+sharp' if n['sharp'] else ''}{'+hit' if n['hit'] else ''}" for k, n in enumerate(found) if k not in used)
    got = set()
    for pos, m in truth:
        T = pos / SR - start
        if any(nn["midi"] == m and abs(nn["t"] - T) < 0.04 for nn in found):
            got.add(pos)
    missed = Counter()
    for pos, m in truth:
        if pos in got:
            continue
        T = pos / SR - start
        d = [q for q in doc.get("dropped", []) if q["midi"] == m and abs(q["t"] - T) < 0.04]
        missed[d[0]["why"] if d else "never"] += 1
    return {
        "instrument": label,
        "scene": scene,
        "audio": "wav" if lossless else "mp3",
        "builder": "old" if legacy else "new",
        "notes": len(truth),
        "found": matched,
        "extra": len(found) - len(used),
        "repeats": f"{repeats_found}/{repeats}",
        "exact": len(exact_errs),
        "exact_median_ms": round(float(np.median(a)), 3) if a.size else None,
        "exact_worst_ms": round(float(a.max()), 3) if a.size else None,
        "false_exact": int((a > 1.0).sum()),
        "all_median_ms": round(float(np.median(np.abs(errs))), 3) if errs else None,
        # Signed (positive = late) for the notes not marked exact: median and 10th/90th percentile.
        "approx_ms": [round(float(np.percentile(approx, q)), 1) for q in (10, 50, 90)] if approx else None,
        "basic_pitch_median_ms": round(float(np.median([abs(nn["shift_ms"]) for nn in found])), 2) if found else None,
        "cut_late": cut_late,
        "extras_by": dict(extras),
        "missed_by": dict(missed),
        "mode": man["suggest"]["mode"],
        "expected_mode": expect_mode,
    }


def run(count: int = 30, seed: int = 3, only: str = "", lossless_too: bool = False, scenes: str = "", compare: bool = False) -> list[dict]:
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, (label, prog, (lo, hi), lens, mode) in enumerate(INSTRUMENTS):
            if only and label != only:
                continue
            for scene in ("apart", "overlap", "fast"):
                if scenes and scene not in scenes.split(","):
                    continue
                x, truth = phrase(prog, lo, hi, lens, count * (2 if scene == "fast" else 1), seed + i, tmp, apart=scene == "apart", fast=scene == "fast")
                for lossless in ((True, False) if lossless_too else (False,)):
                    for legacy in ((True, False) if compare else (False,)):
                        rows.append(check(label, x, truth, mode, tmp, lossless, scene, legacy))
                        print(json.dumps(rows[-1]), flush=True)
    return rows
