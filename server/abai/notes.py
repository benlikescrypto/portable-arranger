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
from .onsets import attacks, refine, zoom
from .stems import write_mp3

MAX_CROP_S = 120.0
MIN_CROP_S = 0.5
PRE_S = 0.2  # audio before the stretch, so a note right at its start has history to model
CROWD_S = 0.025  # another note this close: its attack could be mistaken for this one's
NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def note_name(midi: int) -> str:
    return f"{NAMES[midi % 12]}{midi // 12 - 1}"


SHORT_S = 0.060  # Basic Pitch's own minimum; shorter notes need evidence (see segment())
MIN_NOTE_S = 0.030  # what Basic Pitch is asked for: fast repeated keys are 50-70 ms apart


def basic_pitch(y: np.ndarray, min_note_s: float = MIN_NOTE_S) -> tuple[list[tuple[float, float, int, float]], np.ndarray, np.ndarray]:
    """(start, end, midi, amplitude) per note sorted by start, plus Basic Pitch's onset
    activations (frames x 88 keys, MIDI 21-108) and each frame's time.

    Basic Pitch's own note builder works backwards in time and drops any note shorter than
    its minimum length. A key struck again within about 70 ms leaves the earlier strike that
    short, so it vanished and its sound became part of the note before. It is asked for
    30 ms notes here, and segment() decides which short notes are real."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    from basic_pitch.note_creation import model_frames_to_time

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "crop.wav")
        write_wav(path, y)
        out, _, events = predict(
            path,
            ICASSP_2022_MODEL_PATH,
            onset_threshold=0.5,
            frame_threshold=0.3,
            minimum_note_length=min_note_s * 1000,
            multiple_pitch_bends=False,
        )
    notes = [(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in events]
    notes.sort()
    onset = np.asarray(out["onset"], dtype=np.float32)
    return notes, onset, np.asarray(model_frames_to_time(onset.shape[0]), dtype=np.float64)


def harmonic_level(x: np.ndarray, sr: int, midi: int, a: int, b: int, hop: int = 64) -> tuple[np.ndarray, np.ndarray]:
    """Power at one key's harmonics (the first 8, +-1 bin) over x[a:b], every `hop` samples:
    (sample of each frame centre, dB). Other keys barely touch these bins, so a key struck
    again shows as a jump here even under dense playing."""
    f0 = 440.0 * 2 ** ((midi - 69) / 12)
    nfft = 2048 if f0 < 180 else 1024
    a = max(0, a - nfft // 2)
    seg = x[a : min(x.size, b + nfft // 2)].astype(np.float64)
    if seg.size < nfft + hop:
        return np.zeros(0), np.zeros(0)
    from numpy.lib.stride_tricks import sliding_window_view

    frames = sliding_window_view(seg, nfft)[::hop]
    X = np.abs(np.fft.rfft(frames * np.hanning(nfft), axis=1)) ** 2
    bins = []
    for k in range(1, 9):
        c = int(round(k * f0 * nfft / sr))
        if c + 1 >= X.shape[1] or k * f0 > 8000:
            break
        bins += [c - 1, c, c + 1]
    if not bins:
        return np.zeros(0), np.zeros(0)
    E = X[:, sorted(set(bins))].sum(1)
    centre = a + nfft // 2 + hop * np.arange(E.size)
    return centre, 10 * np.log10(E + 1e-20)


def restrike_rise(x: np.ndarray, sr: int, midi: int, t: float) -> float:
    """How far the key's harmonic level jumps at t (dB): the level just after t against the
    highest level in the 25 ms before (the analysis window's own spread is skipped)."""
    f0 = 440.0 * 2 ** ((midi - 69) / 12)
    half = (2048 if f0 < 180 else 1024) // 2
    c = int(t * sr)
    cen, L = harmonic_level(x, sr, midi, c - half - int(0.03 * sr), c + half + int(0.01 * sr))
    if not L.size:
        return 0.0
    after = L[(cen >= c) & (cen <= c + half + int(0.010 * sr))]
    before = L[(cen >= c - half - int(0.020 * sr)) & (cen <= c)]
    if not after.size or not before.size:
        return 0.0
    # Out of the dip before (a released key, or the low point of its decay) to the peak after.
    return float(after.max() - before.min())


RESTRIKE_ONSET = 0.30  # Basic Pitch's onset activation for a key struck again (its own bar: 0.5)
NEAR_S = 0.025


def near(H: np.ndarray, t: float, tol: float = NEAR_S) -> bool:
    """Is one of the sorted times H within tol of t?"""
    if not H.size:
        return False
    j = int(np.searchsorted(H, t))
    return any(0 <= q < H.size and abs(H[q] - t) <= tol for q in (j - 1, j))


def segment(
    raw: list[tuple[float, float, int, float]], onset: np.ndarray, ft: np.ndarray, hits: list[float]
) -> tuple[list[tuple[float, float, int, float]], dict[tuple[float, int], str]]:
    """Notes with every strike its own note.

    `hits`: attack times from onsets.attacks() (seconds from the start of the stretch). They
    are sure (no false attacks in testing) but miss some strikes in dense playing, so they
    only confirm what Basic Pitch suggests:
    - a key struck again while it rings: inside a note, Basic Pitch's onset activation for its
      key peaks again (>= 0.25, under its own 0.5 bar) at an attack: split the note there.
    - a short note (under 60 ms; Basic Pitch used to drop them all, and with them every fast
      repeat) is kept for now.
    Also returns {(start, key): why} for the notes on probation, which extract_notes() keeps
    only with an attack of their own: "split" (a weak activation peak: a sharp attack or a
    detected attack), "strong" (activation 0.5 or more, as Basic Pitch itself would start a
    note: kept), "short" (a sharp attack or a detected attack)."""
    H = np.asarray(sorted(hits))
    dropped: list[dict] = []

    def hit_near(t: float) -> bool:
        return near(H, t)

    def act(t: float, midi: int) -> float:
        k = midi - 21
        if not (0 <= k < onset.shape[1]) or not ft.size:
            return 0.0
        i = int(np.searchsorted(ft, t))
        return float(onset[max(0, i - 2) : i + 3, k].max(initial=0.0))

    out: list[tuple[float, float, int, float]] = []
    split: dict[tuple[float, int], str] = {}
    for s, e, m, a in raw:
        k = m - 21
        cuts = [s]
        if 0 <= k < onset.shape[1] and ft.size:
            col = onset[:, k]
            i0 = int(np.searchsorted(ft, s + NEAR_S))
            i1 = int(np.searchsorted(ft, e - NEAR_S))
            last = int(np.searchsorted(ft, s))
            for i in range(max(1, i0), min(i1, col.size - 1)):
                t = float(ft[i])
                if not (col[i] >= RESTRIKE_ONSET and col[i] >= col[i - 1] and col[i] > col[i + 1] and t - cuts[-1] >= NEAR_S):
                    continue
                # A clear peak: the activation fell to half of it since the last strike (a
                # measured 80-90 % right on piano, e-piano and marimba re-strikes), or an
                # attack confirms it.
                dip = float(col[last + 1 : i].min(initial=1.0))
                if dip <= 0.5 * col[i] or hit_near(t):
                    cuts.append(t)
                    last = i
        for j, c in enumerate(cuts):
            end = cuts[j + 1] if j + 1 < len(cuts) else e
            out.append((c, end, m, a))
            if j:
                split[(round(c, 4), m)] = "split" if act(c, m) < 0.5 else "strong"
            elif end - c < SHORT_S:
                split[(round(c, 4), m)] = "short"
    out.sort()
    return out, split


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


ROOM_S = 0.8  # this long on its own before the next key: room enough for a sample


def take_score(n: dict, notes: list[dict], length: float) -> int:
    """How good a take of its key this note is for sampling, 0-100: room before the next key
    is struck (40), quiet before it (30), no other notes still ringing under it (20), and an
    exact start (10). A calm, isolated note beats a loud one in the middle of a fast run."""
    room = ((n["next"] if n["next"] is not None else length) - n["t"]) / ROOM_S
    quiet = -n["clear_db"] / 40.0
    ringing = sum(1 for o in notes if o is not n and o["t"] < n["t"] - NEAR_S and o["end"] > n["t"])
    score = 40 * min(1.0, max(0.0, room)) + 30 * min(1.0, max(0.0, quiet)) + 20 / (1 + ringing) + 10 * bool(n["exact"])
    return int(round(score))


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
    legacy = bool(params.get("_legacy"))  # self-test only: the step 2a note builder, for comparison
    raw, onset_act, frame_t = basic_pitch(mono(crop), 0.060 if legacy else MIN_NOTE_S)
    report("notes", 0.45, "Finding every strike")
    hits = [] if legacy else [h.t - start for h in attacks(x, SR, start, end)]
    split: dict[tuple[float, int], str] = {}
    if not legacy:
        raw, split = segment(raw, onset_act, frame_t, hits)
    H = np.asarray(sorted(hits))
    dropped: list[dict] = []
    raw = drop_partials([r for r in raw if r[0] < (b - a) / SR - 0.02])

    report("onsets", 0.55, f"Finding the exact start of {len(raw)} notes")
    onsets = [r[0] for r in raw]
    notes: list[dict] = []
    found: list[tuple[float, float, bool]] = []  # (Basic Pitch time, exact onset, sharp) of notes done so far
    carry: dict[int, tuple[float, float]] = {}  # key -> (start, end) of a dropped short fragment
    for i, (s, e, midi, amp) in enumerate(raw):
        why = split.get((round(s, 4), midi), "")
        if midi in carry and 0 <= s - carry[midi][1] <= NEAR_S:
            # A short fragment with no attack, right before this note: the opening of the same
            # note (a swell Basic Pitch broke in two). Start from the fragment.
            s = carry.pop(midi)[0]
        coarse = start + s
        crowded = any(abs(onsets[j] - s) < CROWD_S for j in range(max(0, i - 8), min(len(raw), i + 9)) if j != i)
        # Do not search back past an earlier note's attack (its own first 4 ms). Notes starting
        # together (within 25 ms: a chord) do not limit each other.
        before = [(t, sh) for bp, t, sh in found if bp < coarse - CROWD_S]
        last = max(before) if before else None
        earliest = max(max(0.0, start - PRE_S), min(last[0] + 0.004, coarse - 0.002) if last else 0.0)
        o = refine(x, SR, coarse, earliest=earliest, crowded=crowded, midi=midi, after_strike=bool(last and last[1]))
        # A split needs a strike of its own: a detected attack with no other key starting
        # then (another key's attack also bumps this key's activation). A short note needs
        # a sharp attack or a detected attack.
        alone = not any(r[2] != midi and abs(r[0] - s) < CROWD_S for r in raw[max(0, i - 8) : i + 9])
        proven = (near(H, s) and alone) if why == "split" else (o.sharp or near(H, s))
        if why in ("split", "short") and not proven:
            dropped.append({"t": round(o.t - start, 4), "midi": midi, "why": why})
            # No attack of its own (a bump in a held note's activation, or a fragment of one):
            # it stays part of the note before, or goes.
            prev = next((n for n in reversed(notes) if n["midi"] == midi), None)
            if prev is not None and why == "split":
                prev["end"] = round(max(prev["end"], e), 4)
            elif why == "short":
                carry[midi] = (s, e)
            continue
        found.append((coarse, o.t, o.sharp))
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
                "via": why or "pitch",  # pitch: Basic Pitch's own note; split/strong/short: see segment()
                "hit": near(H, s),
                "_abs": o.t,
            }
        )
        if i % 20 == 0:
            report("onsets", 0.55 + 0.3 * (i + 1) / max(1, len(raw)), f"Exact starts: {i + 1}/{len(raw)}")

    suggest = suggest_mode(x, notes)
    for n in notes:
        n.pop("_abs", None)
    notes.sort(key=lambda n: n["t"])
    for k, n in enumerate(notes):
        n["i"] = k
    # Where the next key is struck (any key, any detected attack; notes of the same chord
    # do not count): until then this note is heard on its own, which is what step 2b can use.
    starts = sorted([n["t"] for n in notes] + [h for h in hits if 0.0 <= h <= end - start])
    for n in notes:
        later = [t for t in starts if t > n["t"] + NEAR_S]
        n["next"] = round(later[0], 6) if later else None
    for n in notes:
        n["take"] = take_score(n, notes, end - start)

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
    if params.get("_debug"):
        doc["dropped"] = dropped
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
