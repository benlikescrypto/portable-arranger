"""Song -> playable ArrangerBox instruments (SFZ multisamples).

Pipeline: Demucs 6-stem separation -> PANNs tagging over time (which sound plays
where) -> Basic Pitch note events (overtone ghost notes removed) -> a few of the cleanest
notes of each sound, checked with pYIN -> trimmed, tuned, level-matched and (for
sustained sounds) seamlessly looped samples, pitched across the keyboard.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import numpy as np

from .common import SR, Report, decode, file_stem, mono, no_report, rms, safe_name, separate, write_wav

STEMS = ("piano", "other", "guitar", "bass")
WINDOW_S = 6.0

# AudioSet label -> (ArrangerBox sound category as the app browser files it, sustained?)
FAMILY: dict[str, tuple[str, bool]] = {
    "Piano": ("Piano", False),
    "Electric piano": ("Electric", False),
    "Keyboard (musical)": ("Piano", False),
    "Harpsichord": ("Piano", False),
    "Organ": ("Organ", True),
    "Electronic organ": ("Organ", True),
    "Hammond organ": ("Organ", True),
    "Synthesizer": ("Synth", True),
    "Sampler": ("Synth", True),
    "String section": ("Strings", True),
    "Bowed string instrument": ("Strings", True),
    "Violin, fiddle": ("Strings", True),
    "Cello": ("Strings", True),
    "Orchestra": ("Strings", True),
    "Brass instrument": ("Brass", True),
    "Trumpet": ("Brass", True),
    "Trombone": ("Brass", True),
    "French horn": ("Brass", True),
    "Saxophone": ("Woodwind", True),
    "Wind instrument, woodwind instrument": ("Woodwind", True),
    "Flute": ("Woodwind", True),
    "Clarinet": ("Woodwind", True),
    "Accordion": ("Accordion", True),
    "Harmonica": ("Accordion", True),
    "Guitar": ("Guitar", False),
    "Acoustic guitar": ("Guitar", False),
    "Electric guitar": ("Guitar", False),
    "Steel guitar, slide guitar": ("Guitar", False),
    "Bass guitar": ("Bass", False),
    "Double bass": ("Bass", False),
    "Plucked string instrument": ("Guitar", False),
    "Harp": ("Guitar", False),
    "Marimba, xylophone": ("Percussion", False),
    "Vibraphone": ("Percussion", False),
    "Glockenspiel": ("Percussion", False),
}
SUSTAINED = {cat: sus for cat, sus in FAMILY.values()}
STEM_DEFAULT = {"piano": ("Piano", False), "other": ("Synth", True), "guitar": ("Guitar", False), "bass": ("Bass", False)}


@dataclass
class Region:
    stem: str
    category: str
    sustained: bool
    t0: float
    t1: float
    score: float


@dataclass
class Note:
    start: float
    end: float
    pitch: int
    amp: float
    overlap: float = 0.0
    score: float = 0.0
    cents: float = 0.0


def tag_regions(stems: dict[str, np.ndarray], report: Report) -> list[Region]:
    """Which instrument family plays in each stem over time (PANNs CNN14)."""
    import librosa
    from panns_inference import AudioTagging, labels

    from .common import device

    tagger = AudioTagging(checkpoint_path=None, device=device())
    wanted = [i for i, lab in enumerate(labels) if lab in FAMILY]
    out: list[Region] = []
    for stem_name in STEMS:
        y = mono(stems[stem_name])
        level = rms(y)
        if level < 1e-3:
            continue
        y32 = librosa.resample(y, orig_sr=SR, target_sr=32000).astype(np.float32)
        hop = int(WINDOW_S * 32000)
        wins = [y32[i : i + hop] for i in range(0, max(1, len(y32) - hop // 2), hop)]
        loud = np.array([rms(w) for w in wins])
        batch = np.stack([np.pad(w, (0, hop - len(w))) for w in wins])
        clip, _ = tagger.inference(batch)
        quiet = loud < max(level * 0.25, 1e-3)
        fam_labels = [labels[i] for i in wanted]
        cats = sorted({FAMILY[lab][0] for lab in fam_labels})
        # Window scores per category (max over the AudioSet labels of that family).
        sc = np.zeros((len(wins), len(cats)))
        for j, lab in enumerate(fam_labels):
            c = cats.index(FAMILY[lab][0])
            sc[:, c] = np.maximum(sc[:, c], clip[:, wanted[j]])
        # Smooth over neighbouring loud windows: one sound rarely lasts a single window.
        sm = sc.copy()
        for k in range(len(wins)):
            nb = [i for i in (k - 1, k, k + 1) if 0 <= i < len(wins) and not quiet[i]]
            if nb:
                sm[k] = sc[nb].mean(0)
        lab_k = []
        for k in range(len(wins)):
            if quiet[k]:
                lab_k.append(None)
            elif stem_name == "bass":
                lab_k.append("Bass")
            elif sm[k].max() < 0.04:
                lab_k.append(STEM_DEFAULT[stem_name][0])
            else:
                lab_k.append(cats[int(np.argmax(sm[k]))])
        # A one-window blip between two windows of one sound belongs to that sound.
        for k in range(1, len(wins) - 1):
            if lab_k[k] and lab_k[k - 1] and lab_k[k - 1] == lab_k[k + 1] and lab_k[k] != lab_k[k - 1]:
                lab_k[k] = lab_k[k - 1]
        cur: Region | None = None
        for k, w in enumerate(wins):
            t0, t1 = k * WINDOW_S, k * WINDOW_S + len(w) / 32000
            cat = lab_k[k]
            if cat is None:
                cur = None
                continue
            sus = SUSTAINED.get(cat, STEM_DEFAULT[stem_name][1])
            score = float(sm[k].max())
            if cur is not None and cur.category == cat:
                cur.t1 = t1
                cur.score += score
            else:
                cur = Region(stem_name, cat, sus, t0, t1, score)
                out.append(cur)
    return [r for r in out if r.t1 - r.t0 >= WINDOW_S * 0.99]


def note_events(y: np.ndarray, tmp: str) -> list[Note]:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    write_wav(tmp, y)
    _, _, events = predict(
        tmp,
        ICASSP_2022_MODEL_PATH,
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=120,
        multiple_pitch_bends=False,
    )
    notes = [Note(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in events]
    notes.sort(key=lambda n: n.start)
    return notes


def clean_notes(raw: list[Note], bass: list[Note] | None) -> list[Note]:
    """Remove bass-line leakage first (notes doubling the bass stem, and notes far below
    the part's register: Demucs sometimes leaves the bass in a keys stem) - otherwise a real note an octave or a
    fifth above a leaked bass note looks like its overtone, then overtone ghost notes, then mark
    how much each remaining note overlaps others."""
    notes = drop_partials(raw if bass is None else main_register(drop_bleed(raw, bass)))
    mark_overlap(notes)
    return notes


PARTIALS = (12, 19, 24, 28, 31, 36)  # octave, 12th, 2 octaves, ... above a played note


def drop_partials(notes: list[Note]) -> list[Note]:
    """Basic Pitch reports strong overtones (organ drawbars, brass, bowed strings) as extra
    notes that start with the real one. Remove them, so a single held organ note is not
    mistaken for a chord and the overtone is not sampled as a note of its own."""
    starts = np.array([n.start for n in notes])
    keep = []
    for n in notes:
        i0, i1 = np.searchsorted(starts, n.start - 0.07), np.searchsorted(starts, n.start + 0.07)
        ghost = any(
            (n.pitch - m.pitch) in PARTIALS and m.amp >= 0.6 * n.amp and m.end >= n.end - 0.15
            for m in notes[i0:i1]
            if m is not n
        )
        if not ghost:
            keep.append(n)
    return keep


def mark_overlap(notes: list[Note]) -> None:
    """Fraction of each note's length shared with other comparable notes (a chord, or a
    neighbour still ringing). Much quieter notes are bleed from other instruments and
    much lower ones are another part; neither stops a note from being a clean sample."""
    for i, n in enumerate(notes):
        span = max(1e-3, n.end - n.start)
        ov = 0.0
        for j in range(max(0, i - 40), min(len(notes), i + 40)):
            if j == i:
                continue
            m = notes[j]
            if m.amp < 0.4 * n.amp or m.pitch < n.pitch - 15:
                continue
            # An overtone or sub-octave starting with the note is part of its sound.
            if abs(m.pitch - n.pitch) in PARTIALS and abs(m.start - n.start) < 0.07:
                continue
            a, b = max(n.start - 0.05, m.start), min(n.end, m.end)
            if b > a:
                ov += b - a
        n.overlap = ov / span


def drop_bleed(notes: list[Note], bass: list[Note]) -> list[Note]:
    """Remove notes that are the bass line leaking into this stem (same pitch or octave,
    sounding at the same time as a bass-stem note)."""
    if not bass:
        return notes
    starts = np.array([m.start for m in bass])
    keep = []
    for n in notes:
        i0 = int(np.searchsorted(starts, n.start - 4.0))
        leak = False
        for m in bass[i0 : i0 + 60]:
            if m.start > n.end:
                break
            if (n.pitch - m.pitch) % 12 == 0 and abs(n.pitch - m.pitch) <= 12:
                ov = min(n.end, m.end) - max(n.start, m.start)
                if ov > 0.5 * (n.end - n.start):
                    leak = True
                    break
        if not leak:
            keep.append(n)
    return keep


def main_register(notes: list[Note]) -> list[Note]:
    """Drop notes far below the part's own register (bass bleeding into a keys stem)."""
    if len(notes) < 4:
        return notes
    w = np.array([n.amp * (n.end - n.start) for n in notes])
    p = np.array([n.pitch for n in notes], float)
    order = np.argsort(p)
    cum = np.cumsum(w[order])
    median = p[order][np.searchsorted(cum, cum[-1] / 2)]
    return [n for n in notes if n.pitch >= median - 15]


def measure_pitch(seg: np.ndarray, midi: int) -> tuple[float, float]:
    """(cents offset from midi, voiced fraction) with pYIN."""
    import librosa

    f0, voiced, _ = librosa.pyin(
        seg,
        fmin=librosa.midi_to_hz(midi - 4),
        fmax=librosa.midi_to_hz(midi + 4),
        sr=SR,
        frame_length=4096 if midi < 48 else 2048,
        hop_length=512,
    )
    ok = voiced & np.isfinite(f0)
    if ok.sum() < 3:
        return 0.0, 0.0
    cents = 1200 * np.log2(f0[ok] / librosa.midi_to_hz(midi))
    return float(np.median(cents)), float(ok.mean())


def find_loop(x: np.ndarray, a: int, b: int, midi: int) -> tuple[int, int] | None:
    """Loop points inside x[a:b] (mono analysis) with the best waveform match."""
    import librosa

    period = SR / float(librosa.midi_to_hz(midi))
    if b - a < int(0.35 * SR):
        return None
    win = 512
    target = min(int(1.2 * SR), (b - a) // 2)
    best, pts = -1.0, None
    end_cands = np.linspace(b - win - int(0.05 * SR), b - win, 6).astype(int)
    for le in end_cands:
        k0 = max(1, int((target * 0.6) / period))
        k1 = max(k0 + 1, int(target / period))
        for k in range(k0, k1 + 1, max(1, (k1 - k0) // 40)):
            ls = int(round(le - k * period))
            if ls < a or ls + win > len(x) or le + win > len(x):
                continue
            u, v = x[ls : ls + win], x[le : le + win]
            c = float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9))
            if c > best:
                best, pts = c, (ls, le)
    if pts is None or best < 0.5:
        return None
    return pts


def bake_loop(seg: np.ndarray, ls: int, le: int) -> np.ndarray:
    """Equal-power crossfade so playback jumping from le back to ls is seamless."""
    cf = min(int(0.08 * SR), (le - ls) // 2, ls)
    out = seg[:, : le].copy()
    if cf <= 8:
        return out
    t = np.linspace(0, np.pi / 2, cf)
    fo, fi = np.cos(t), np.sin(t)
    out[:, le - cf : le] = seg[:, le - cf : le] * fo + seg[:, ls - cf : ls] * fi
    return out


MAX_ZONES = 8
STRINGS_ATTACK = 0.12  # seconds to reach full level; slower than this is bowed, not blown


def retitle(name: str, cat: str, used: set[str]) -> str:
    title = f"{name} {cat}"[:44]
    k = 2
    while title in used:
        title = f"{name} {cat} {k}"[:44]
        k += 1
    return title


def envelope(y: np.ndarray, rs: list[Region]) -> np.ndarray:
    hop = int(0.05 * SR)
    seg = np.concatenate([y[int(r.t0 * SR) : int(r.t1 * SR)] for r in rs])
    n = len(seg) // hop
    return np.sqrt((seg[: n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)


def same_instrument(stems: dict[str, np.ndarray], a: tuple[str, list[Region]], b: tuple[str, list[Region]]) -> bool:
    """True when sound a is another stem's copy of sound b: Demucs split one instrument
    over two stems, so over a's time both stems swell and fade together."""
    (sa, ra), (sb, rb) = a, b
    if sa == sb or sa == "bass" or sb == "bass":
        return False
    shared = [Region(sa, "", False, max(x.t0, y.t0), min(x.t1, y.t1), 0) for x in ra for y in rb if min(x.t1, y.t1) - max(x.t0, y.t0) > 1.0]
    if sum(r.t1 - r.t0 for r in shared) < 0.5 * sum(r.t1 - r.t0 for r in ra):
        return False
    ea, eb = envelope(mono(stems[sa]), shared), envelope(mono(stems[sb]), shared)
    if len(ea) < 20:
        return False
    return float(np.corrcoef(np.log(ea), np.log(eb))[0, 1]) > 0.8


def attack_time(seg: np.ndarray) -> float:
    """Seconds from onset to 90% of the note's peak level (10 ms RMS envelope)."""
    hop = int(0.01 * SR)
    head = seg[: int(1.0 * SR)]
    env = np.array([rms(head[i : i + hop]) for i in range(0, max(1, len(head) - hop), hop)])
    if len(env) < 3 or env.max() <= 0:
        return 0.0
    return float(np.argmax(env >= 0.9 * env.max()) * hop / SR)


def interior_notes(notes: list[Note], own: list[Region], others: list[Region]) -> list[Note]:
    """Notes inside this sound's regions. Where a region borders a different sound on the
    same stem, the change can fall anywhere in the boundary window, so notes in the half
    window next to it are only used when the region has too few notes of its own."""
    margin = WINDOW_S / 2

    def inside(n: Note, strict: bool) -> bool:
        for r in own:
            a, b = r.t0 - 0.05, r.t1 + 0.5
            if strict:
                if any(abs(o.t1 - r.t0) < 0.1 for o in others):
                    a = r.t0 + margin
                if any(abs(o.t0 - r.t1) < 0.1 for o in others):
                    b = r.t1 - margin
            if a <= n.start and n.end <= b:
                return True
        return False

    strict = [n for n in notes if inside(n, True)]
    return strict if len(strict) >= 6 else [n for n in notes if inside(n, False)]


def build_instrument(
    stem: np.ndarray,
    notes: list[Note],
    region: Region,
    name: str,
    outdir: str,
    base: str,
    all_notes: list[Note] | None = None,
) -> dict | None:
    y = mono(stem)
    min_len = 0.35 if region.sustained else 0.2
    inside = [n for n in notes if n.start >= region.t0 - 0.05 and n.end <= region.t1 + 0.5 and n.end - n.start >= min_len]
    if not inside:
        return None
    lo_rms = rms(y) * 0.2
    cands: list[Note] = []
    for limit in (0.12, 0.35):
        cands = [n for n in inside if n.overlap <= limit]
        if len(cands) >= 3:
            break
    scored: dict[int, Note] = {}
    for n in sorted(cands, key=lambda n: -(n.amp * min(2.0, n.end - n.start)))[:160]:
        if n.pitch in scored and scored[n.pitch].score > n.amp * 2:
            continue
        a, b = int(n.start * SR), int(min(n.end, n.start + 2.5) * SR)
        seg = y[a:b]
        if rms(seg) < lo_rms:
            continue
        cents, voiced = measure_pitch(seg, n.pitch)
        if voiced < 0.5 or abs(cents) > 60:
            continue
        n.cents = cents
        n.score = n.amp * min(2.0, n.end - n.start) * voiced * (1.0 - min(0.9, n.overlap))
        if n.pitch not in scored or n.score > scored[n.pitch].score:
            scored[n.pitch] = n
    if not scored:
        return None
    # A few of the cleanest notes, at least 3 semitones apart, pitched to cover the
    # keyboard. Fewer roots means every key plays one of the instrument's best notes.
    chosen: list[Note] = []
    for n in sorted(scored.values(), key=lambda n: -n.score):
        if all(abs(n.pitch - c.pitch) >= 3 for c in chosen):
            chosen.append(n)
        if len(chosen) >= MAX_ZONES:
            break
    chosen.sort(key=lambda n: n.pitch)

    regions = []
    attacks: list[float] = []
    target_rms = 10 ** (-20 / 20)
    zones = []
    for k, n in enumerate(chosen):
        a = max(0, int((n.start - 0.012) * SR))
        nxt = min((m.start for m in (all_notes or notes) if m.start > n.start + 0.05), default=n.end + 1.0)
        tail = min(0.6 if not region.sustained else 0.25, max(0.05, nxt - n.end - 0.02))
        b = min(stem.shape[1], int((n.end + tail) * SR))
        seg = stem[:, a:b].astype(np.float32).copy()
        fade_in = int(0.004 * SR)
        seg[:, :fade_in] *= np.linspace(0, 1, fade_in)[None, :]
        body = seg[:, int(0.05 * SR) : max(int(0.06 * SR), seg.shape[1] - int(tail * SR))]
        g = target_rms / max(rms(body), 1e-6)
        seg *= min(g, 30.0)
        loop = None
        if region.sustained:
            sm = mono(seg)
            attack = int(0.12 * SR)
            body_end = seg.shape[1] - int(tail * SR) - int(0.03 * SR)
            pts = find_loop(sm, attack, body_end, n.pitch)
            if pts:
                seg = bake_loop(seg, *pts)
                loop = pts
        if loop is None:
            fo = min(int(0.03 * SR), seg.shape[1] // 4)
            seg[:, seg.shape[1] - fo :] *= np.linspace(1, 0, fo)[None, :]
        attacks.append(attack_time(mono(seg)))
        fname = f"{base}_{n.pitch:03d}.wav"
        write_wav(os.path.join(outdir, fname), seg)
        zones.append((n, fname, loop, seg.shape[1]))
    # Keyboard ranges: split halfway between neighbouring roots.
    lines = [
        "// ArrangerBox AI sampled instrument",
        "<control>",
        "<global>",
        f"global_label={name}",
        f"ab_category={region.category}",
        "<group>",
        f"ampeg_attack=0.003 ampeg_release={0.35 if region.sustained else 0.25}",
    ]
    files = []
    for k, (n, fname, loop, frames) in enumerate(zones):
        lo = max(21, n.pitch - 12) if k == 0 else (zones[k - 1][0].pitch + n.pitch) // 2 + 1
        hi = min(108, n.pitch + 12) if k == len(zones) - 1 else (n.pitch + zones[k + 1][0].pitch) // 2
        tune = int(round(-n.cents))
        lines.append("<region>")
        op = f"sample={fname} lokey={lo} hikey={hi} pitch_keycenter={n.pitch} tune={tune}"
        if loop:
            op += f" loop_mode=loop_continuous loop_start={loop[0]} loop_end={loop[1] - 1}"
        else:
            op += " loop_mode=no_loop"
        lines.append(op)
        files.append(fname)
        regions.append({"root": n.pitch, "lo": lo, "hi": hi, "tune": tune, "loop": bool(loop), "seconds": round(frames / SR, 2)})
    sfz = base + ".sfz"
    with open(os.path.join(outdir, sfz), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    files.append(sfz)
    return {
        "name": name,
        "category": region.category,
        "stem": region.stem,
        "file": sfz,
        "sustained": region.sustained,
        "zones": regions,
        "range": [regions[0]["lo"], regions[-1]["hi"]],
        "from": [round(region.t0, 1), round(region.t1, 1)],
        "files": files,
        "attack": round(float(np.median(attacks)), 3) if len(attacks) >= 2 else None,
    }


def extract_sounds(path: str, name: str, outdir: str, report: Report = no_report) -> dict:
    os.makedirs(outdir, exist_ok=True)
    name = safe_name(name)
    stem_name = file_stem(name)
    report("decode", 0.02, "Reading the song")
    x = decode(path)
    duration = x.shape[1] / SR
    report("separate", 0.08, "Separating the instruments (Demucs 6 stems)")
    stems = separate(x, "htdemucs_6s")
    report("tag", 0.4, "Listening for piano, strings, organ…")
    regions = tag_regions(stems, report)
    # Each (stem, sound) pair is one instrument, played wherever that sound was heard.
    groups: dict[tuple[str, str], list[Region]] = {}
    for r in regions:
        groups.setdefault((r.stem, r.category), []).append(r)
    # Strongest first; a weaker sound that is a split-off copy of a stronger one is dropped.
    level = {k: float(np.mean(envelope(mono(stems[k[0]]), rs))) for k, rs in groups.items()}
    ranked = []
    for key, rs in sorted(groups.items(), key=lambda kv: -level[kv[0]]):
        if not any(same_instrument(stems, (key[0], rs), (k2[0], r2)) for k2, r2 in ranked):
            ranked.append((key, rs))
    ranked = sorted(ranked, key=lambda kv: -sum(r.score for r in kv[1]))[:6]
    report("notes", 0.5, "Finding clean notes (Basic Pitch)")
    note_cache: dict[str, list[Note]] = {}
    bass_notes: list[Note] = []
    if rms(mono(stems["bass"])) > 1e-3:
        bass_notes = clean_notes(note_events(mono(stems["bass"]), "/tmp/bass.wav"), None)
        note_cache["bass"] = bass_notes
    instruments = []
    used_names: set[str] = set()
    for gi, ((stem_key, cat), rs) in enumerate(ranked):
        report("build", 0.55 + 0.4 * gi / max(1, len(ranked)), f"Sampling {cat} from the {stem_key} part")
        if stem_key not in note_cache:
            note_cache[stem_key] = clean_notes(note_events(mono(stems[stem_key]), f"/tmp/{stem_key}.wav"), bass_notes)
        stem_notes = note_cache[stem_key]
        span = Region(stem_key, cat, rs[0].sustained, min(r.t0 for r in rs), max(r.t1 for r in rs), sum(r.score for r in rs))
        notes = interior_notes(stem_notes, rs, [r for r in regions if r.stem == stem_key and r.category != cat])
        if stem_key != "bass":
            notes = main_register(notes)
        title = retitle(name, cat, used_names)
        inst = build_instrument(stems[stem_key], notes, span, title, outdir, f"{stem_name}_{file_stem(cat)}_{stem_key}", stem_notes)
        if inst and stem_key != "bass" and len(inst["zones"]) < 2:
            inst = None  # one stray note is not an instrument
        if inst and cat in ("Brass", "Strings") and inst["attack"] is not None:
            # Bowed strings swell in; brass speaks at once. AudioSet tagging confuses the two.
            real = "Strings" if inst["attack"] >= STRINGS_ATTACK else "Brass"
            if real != cat:
                cat = real
                inst = build_instrument(
                    stems[stem_key], notes, Region(stem_key, cat, True, span.t0, span.t1, span.score),
                    retitle(name, cat, used_names), outdir, f"{stem_name}_{file_stem(cat)}_{stem_key}", stem_notes,
                )
        if inst:
            used_names.add(inst["name"])
            inst["segments"] = [[round(r.t0, 1), round(r.t1, 1)] for r in rs]
            instruments.append(inst)
    if not instruments:
        raise ValueError("No clean notes were found to sample. Try a song with a solo instrument part.")
    files = sorted({f for i in instruments for f in i.pop("files")})
    manifest = {
        "kind": "sounds",
        "name": name,
        "duration": round(duration, 2),
        "timeline": [{"stem": r.stem, "category": r.category, "start": round(r.t0, 1), "end": round(r.t1, 1)} for r in regions],
        "styles": [],
        "sounds": instruments,
        "files": files,
    }
    with open(os.path.join(outdir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    report("done", 1.0, f"{len(instruments)} sound{'s' if len(instruments) != 1 else ''}")
    return manifest
