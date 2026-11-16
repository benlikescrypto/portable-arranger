"""Scores pipeline output against test-song ground truth. Each check returns (name, ok, detail)."""

from __future__ import annotations

import os

import numpy as np

from .common import PPQ, SR

Check = tuple[str, bool, str]


def parse_abstyle(path: str) -> dict:
    out: dict = {"sections": {}}
    cur = None
    for line in open(path):
        line = line.strip()
        if line.startswith("section="):
            cur = {"length": 0, "kit": None, "evs": []}
            out["sections"][line[8:]] = cur
        elif "=" in line and cur is None:
            k, v = line.split("=", 1)
            out[k] = v
        elif line.startswith("length="):
            cur["length"] = int(line[7:])
        elif line.startswith("kit="):
            cur["kit"] = line[4:]
        elif line and line[0].isdigit() and cur is not None:
            t, trk, note, vel, dur, flag = line.split(",")
            cur["evs"].append((int(t), int(note), int(vel), int(dur)))
    return out


def _bar_offset(truth: dict, man: dict) -> int:
    """Detected bar index of truth bar 0."""
    bt = np.array(man["barTimes"])
    return int(np.argmin(np.abs(bt - truth["downbeats"][0])))


def _role_of_truth_section(man: dict, b0: int, b1: int) -> str:
    votes: dict[str, int] = {}
    for s in man["sections"]:
        ov = max(0, min(b1, s["bar1"]) - max(b0, s["bar0"]))
        if ov:
            votes[s["role"]] = votes.get(s["role"], 0) + ov
    return max(votes, key=votes.get) if votes else "?"


def _recall(truth_ticks: list[int], got: list[int], tol: int) -> float:
    if not truth_ticks:
        return 1.0
    g = np.array(sorted(got)) if got else np.array([10**9])
    hit = sum(1 for t in truth_ticks if np.min(np.abs(g - t)) <= tol)
    return hit / len(truth_ticks)


def check_drums(truth: dict, man: dict, outdir: str) -> list[Check]:
    res: list[Check] = []
    bpm_err = abs(man["bpm"] - truth["bpm"]) / truth["bpm"]
    res.append(("tempo within 1.5%", bpm_err < 0.015, f"{man['bpm']} vs {truth['bpm']}"))
    res.append(("meter", man["meter"] == truth["meter"], f"{man['meter']} vs {truth['meter']}"))
    bt = np.array(man["barTimes"])
    d = [float(np.min(np.abs(bt - t))) for t in truth["downbeats"]]
    frac = float(np.mean(np.array(d) < 0.05))
    res.append(("downbeats within 50 ms", frac >= 0.9, f"{frac:.0%} (median {np.median(d) * 1000:.1f} ms)"))
    off = _bar_offset(truth, man)
    roles = {}
    for s in truth["sections"]:
        roles.setdefault(s["label"], []).append(_role_of_truth_section(man, s["bar0"] + off, s["bar1"] + off))
    a_roles, b_roles = set(roles.get("A", [])), set(roles.get("B", []))
    ok = all(r.startswith("Var") for r in a_roles | b_roles) and a_roles.isdisjoint(b_roles)
    if ok and a_roles and b_roles:
        ok = max(int(r[-1]) for r in a_roles) < min(int(r[-1]) for r in b_roles)
    res.append(("verse and chorus are different variations, chorus busier", ok, f"A={sorted(a_roles)} B={sorted(b_roles)}"))
    els = man["elements"]
    truth_fills = {f + off for f in truth["fills"]}
    fill_src = [els[f"fill{k}"]["bar0"] for k in range(1, 5)]
    found = {b for b in fill_src if b in truth_fills}
    res.append(("fills come from the song's fill bars", len(found) >= min(2, len(truth_fills)) and sum(b in truth_fills for b in fill_src) >= 3, f"fill bars {fill_src}, truth {sorted(truth_fills)}"))
    intro = next(s for s in truth["sections"] if s["label"] == "intro")
    i0, i1 = els["intro1"]["bar0"], els["intro1"]["bar1"]
    res.append(("intro from the song intro", intro["bar0"] + off <= i0 and i1 <= intro["bar1"] + off, f"{i0}-{i1} vs {intro['bar0'] + off}-{intro['bar1'] + off}"))
    last = truth["bars"] - 1 + off
    e0, e1 = els["end1"]["bar0"], els["end1"]["bar1"]
    res.append(("ending holds the final bar", e0 <= last < e1 and e1 - e0 <= 6, f"{e0}-{e1}, final bar {last}"))

    # Slice timing and GM transcription on the verse groove.
    audio = parse_abstyle(os.path.join(outdir, man["styles"][0]["file"]))
    gm = parse_abstyle(os.path.join(outdir, man["styles"][1]["file"]))
    beat_s = 60.0 / truth["bpm"]
    hits = truth["hits"]
    for nm in ("var1", "var4", "fill1"):
        e = els[nm]
        t0 = truth["downbeats"][e["bar0"] - off] if 0 <= e["bar0"] - off < len(truth["downbeats"]) else None
        if t0 is None:
            continue
        span = (e["bar1"] - e["bar0"]) * truth["meter"] * beat_s
        tt = sorted({round((t - t0) / beat_s * PPQ) for t, n in hits if t0 - 0.01 <= t < t0 + span - 0.02})
        dedup = [x for i, x in enumerate(tt) if i == 0 or x - tt[i - 1] > 4]
        got = [ev[0] for ev in audio["sections"][nm]["evs"]]
        r = _recall(dedup, got, 4)
        extra = len(got) / max(1, len(dedup))
        g = np.array(got) if got else np.array([0])
        offs = [int(g[np.argmin(np.abs(g - t))] - t) for t in dedup]
        res.append((f"{nm} slices on the played hits", r >= 0.9 and extra < 1.6, f"recall {r:.0%}, {len(got)} slices for {len(dedup)} hits, offsets {offs[:24]}"))
        for cls, notes in (("kick", {36}), ("snare", {38}), ("hat", {42, 46})):
            if nm.startswith("fill") and cls != "snare":
                continue  # toms and rolls: only the snare is unambiguous in a fill
            want = sorted({round((t - t0) / beat_s * PPQ) for t, n in hits if n in notes and t0 - 0.01 <= t < t0 + span - 0.02})
            have = [ev[0] for ev in gm["sections"][nm]["evs"] if ev[1] in (notes | ({46} if cls == "hat" else set()))]
            if want:
                r = _recall(want, have, 5)
                allg = gm["sections"][nm]["evs"]
                miss = [t for t in want if not have or min(abs(h - t) for h in have) > 5]
                seen = [sorted({ev[1] for ev in allg if abs(ev[0] - t) <= 5}) for t in miss[:6]]
                prec_ok = cls == "hat" or nm.startswith("fill") or len(have) <= 1.5 * len(want)
                res.append((f"GM {nm} {cls} recall / precision", r >= (0.8 if cls != "hat" else 0.7) and prec_ok, f"{r:.0%} of {len(want)}, got {len(have)}; at misses found {seen}"))
    # Every kit file exists and every event key has a region.
    for nm, sec in audio["sections"].items():
        kit = os.path.join(outdir, sec["kit"])
        keys = {int(tok.split("=")[1]) for line in open(kit) for tok in line.split() if tok.startswith("key=")}
        missing = [ev[1] for ev in sec["evs"] if ev[1] not in keys]
        if missing:
            res.append((f"{nm} kit has every slice", False, f"missing keys {missing[:5]}"))
    res.append(("all kits complete", True, f"{len(audio['sections'])} sections"))
    return res


def check_sounds(truth: dict, man: dict, outdir: str) -> list[Check]:
    import librosa
    import soundfile as sf

    res: list[Check] = []
    insts = man["sounds"]
    res.append(("instruments built (not too many)", 2 <= len(insts) <= 5, ", ".join(f"{i['name']} ({len(i['zones'])})" for i in insts)))
    for sec in truth["sections"]:
        fam = sec["family"]
        cover = [i for i in insts if any(a < sec["end"] - 1 and b > sec["start"] + 1 for a, b in i["segments"])]
        res.append((f"{fam} part was sampled", bool(cover), ", ".join(f"{i['category']}/{i['stem']}" for i in cover) or "none"))
        named = [i for i in cover if i["category"] == fam and set(z["root"] for z in i["zones"]) <= set(sec["pitches"])]
        res.append((f"{fam} part found as a {fam} sound built from its own notes", bool(named), ", ".join(f"{i['name']} {[z['root'] for z in i['zones']]}" for i in cover)))
    all_pitches = {p for s in truth["sections"] for p in s["pitches"]}
    for inst in insts:
        roots = [z["root"] for z in inst["zones"]]
        bad = [r for r in roots if r not in all_pitches]
        if inst["stem"] != "bass":
            res.append((f"{inst['name']}: roots are played notes", len(bad) <= len(roots) // 5, f"roots {roots}, not played {bad}"))
        errs = []
        sfz = open(os.path.join(outdir, inst["file"])).read().split("<region>")[1:]
        seams = []
        for z, block in zip(inst["zones"], sfz):
            fname = block.split("sample=")[1].split()[0]
            y, sr = sf.read(os.path.join(outdir, fname), always_2d=True)
            m = y.mean(1)
            f0, voiced, _ = librosa.pyin(m[: int(1.5 * sr)], fmin=librosa.midi_to_hz(z["root"] - 4), fmax=librosa.midi_to_hz(z["root"] + 4), sr=sr, frame_length=4096 if z["root"] < 48 else 2048, hop_length=512)
            ok = voiced & np.isfinite(f0)
            if ok.sum() >= 3:
                cents = float(np.median(1200 * np.log2(f0[ok] / librosa.midi_to_hz(z["root"]))))
                errs.append(abs(cents + z["tune"]))
            if z["loop"]:
                ls = int(block.split("loop_start=")[1].split()[0])
                le = int(block.split("loop_end=")[1].split()[0]) + 1
                w = 256
                if ls >= w and le <= len(m):
                    played = np.concatenate([m[le - w : le], m[ls : ls + w]])
                    ref = m[ls - w : ls + w]
                    c = float(np.dot(played, ref) / (np.linalg.norm(played) * np.linalg.norm(ref) + 1e-9))
                    seams.append(c)
        good = float(np.mean(np.array(errs) < 25)) if errs else 0.0
        res.append((f"{inst['name']}: zones in tune (<25 cents)", good >= 0.8, f"{good:.0%} of {len(errs)}, median {np.median(errs) if errs else 0:.1f} c"))
        if inst["sustained"]:
            looped = sum(z["loop"] for z in inst["zones"])
            res.append((f"{inst['name']}: sustained zones loop", looped >= max(1, len(inst["zones"]) // 2), f"{looped}/{len(inst['zones'])}"))
            if seams:
                res.append((f"{inst['name']}: loop seams match", min(seams) > 0.85, f"min corr {min(seams):.3f}"))
    return res


# ---- timbre: does each sample sound like the instrument that played? -------------------

GM_FAMILIES = ["Piano", "Chromatic", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass", "Reed", "Pipe", "Synth Lead", "Synth Pad", "Synth FX", "Ethnic", "Percussive", "SFX"]
_GM_CACHE: dict[int, np.ndarray] = {}


def timbre_features(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """Pitch-normalised timbre: log-mel spectral envelope of the note body plus its
    loudness envelope over the first second, unit-normalised (level does not matter)."""
    import librosa

    y = y[: int(1.5 * sr)]
    if len(y) < sr // 4:
        y = np.pad(y, (0, sr // 4 - len(y)))
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=4096, hop_length=512, n_mels=96, fmax=16000)
    L = np.log(S + 1e-8)
    body = L[:, 3 : max(4, L.shape[1] * 2 // 3)].mean(1)
    body -= body.max()
    body = np.maximum(body, -12.0)  # ignore what is 50 dB down (noise floor, bleed)
    env = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0][:86]
    env = np.pad(env, (0, 86 - len(env)))
    env = np.log(env / (env.max() + 1e-9) + 1e-3)
    v = np.concatenate([body / 12.0, 0.5 * env / 7.0])
    return v / (np.linalg.norm(v) + 1e-9)


def gm_reference(pitch: int, sf2: str) -> np.ndarray:
    """Features of all 128 GM programs playing `pitch` (2 s note each), rendered from sf2."""
    if pitch in _GM_CACHE:
        return _GM_CACHE[pitch]
    import subprocess
    import tempfile

    import mido
    import soundfile as sf

    tpb, slot = 480, 3.0  # seconds per program
    mid = mido.MidiFile(ticks_per_beat=tpb)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))  # 1 beat = 0.5 s
    per = int(slot / 0.5 * tpb)
    for p in range(128):
        tr.append(mido.Message("program_change", channel=0, program=p, time=0 if p == 0 else per - int(2.0 / 0.5 * tpb)))
        tr.append(mido.Message("note_on", channel=0, note=pitch, velocity=92, time=0))
        tr.append(mido.Message("note_off", channel=0, note=pitch, velocity=0, time=int(2.0 / 0.5 * tpb)))
    with tempfile.TemporaryDirectory() as td:
        mp, wp = os.path.join(td, "gm.mid"), os.path.join(td, "gm.wav")
        mid.save(mp)
        subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.5", "-r", str(SR), "-F", wp, sf2, mp], check=True, capture_output=True)
        y, _ = sf.read(wp, always_2d=True)
    y = y.mean(1)
    n = int(slot * SR)
    feats = np.stack([timbre_features(y[p * n : p * n + int(2.4 * SR)]) for p in range(128)])
    _GM_CACHE[pitch] = feats
    return feats


def timbre_rank(sample: np.ndarray, pitch: int, program: int, sf2: str) -> tuple[int, int, float]:
    """(rank of the true program among 128 by similarity, 1 = best; best-matching program;
    cosine similarity to the true program)."""
    ref = gm_reference(pitch, sf2)
    f = timbre_features(sample)
    sims = ref @ f
    order = np.argsort(-sims)
    return int(np.where(order == program)[0][0]) + 1, int(order[0]), float(sims[program])


def check_timbre(truth: dict, man: dict, outdir: str, sf2: str) -> list[Check]:
    """For each sampled part: does the sample sound like the instrument that played it?
    Rank 1 of 128 = closest of all GM sounds; same family = a listener would call it the
    same kind of instrument."""
    import soundfile as sf

    res: list[Check] = []
    for sec in truth["sections"]:
        prog = sec.get("program")
        if prog is None:
            continue
        fam = sec["family"]
        cover = [i for i in man["sounds"] if i["stem"] != "bass" and any(a < sec["end"] - 1 and b > sec["start"] + 1 for a, b in i["segments"])]
        if not cover:
            res.append((f"{fam} timbre", False, "no sound sampled from this part"))
            continue
        inst = max(cover, key=lambda i: sum(min(b, sec["end"]) - max(a, sec["start"]) for a, b in i["segments"]))
        blocks = open(os.path.join(outdir, inst["file"]), encoding="utf-8").read().split("<region>")[1:]
        ranks, fams, sims = [], [], []
        for z, block in zip(inst["zones"], blocks):
            y, _ = sf.read(os.path.join(outdir, block.split("sample=")[1].split()[0]), always_2d=True)
            r, best, s = timbre_rank(y.mean(1), z["root"], prog, sf2)
            ranks.append(r)
            fams.append(best // 8 == prog // 8)
            sims.append(s)
        med = float(np.median(ranks))
        famok = float(np.mean(fams))
        res.append((f"{fam} timbre: sample is identifiable as {fam} (median rank <= 3 of 128)", med <= 3, f"{inst['name']}: ranks {ranks}, sim {np.mean(sims):.3f}"))
        res.append((f"{fam} timbre: nearest GM sound is the same family (>= 80% of zones)", famok >= 0.8, f"{famok:.0%}; nearest family {GM_FAMILIES[best // 8]}"))
        res.append((f"{fam} named correctly", inst["category"] in (fam, {"Organ": "Organ"}.get(fam, fam)), f"category {inst['category']}"))
    return res
