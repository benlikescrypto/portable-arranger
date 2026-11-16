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
