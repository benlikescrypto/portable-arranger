"""Professionally recorded, openly licensed sampled instruments, prepared once for
ArrangerBox, and matching an instrument heard in a song to the closest of them.

A note cut out of a finished mix carries the song's reverb, other instruments' bleed and
separation artifacts, and only the notes the song played. So for the instruments a
library covers, the playable sound is the closest real multisampled instrument, its
brightness matched to the song; the song's own notes stay available as a second sound.

The prepared library lives on the data volume (/data/lib); the app downloads each
instrument once into Documents/ai/lib and every song's .sfz points at it ("../lib/...").
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass, field

import numpy as np

from .common import SR, mono, rms, write_wav

LIB_VERSION = 1
SOURCES = {
    "salamander": ("https://github.com/sfzinstruments/SalamanderGrandPiano.git", ["Samples"]),
    "vsco": (
        "https://github.com/sgossner/VSCO-2-CE.git",
        [
            "Strings/Violin Section/susVib",
            "Strings/Viola Section/susvib",
            "Strings/Cello Section/susvib",
            "Strings/Solo Contrabass/SusVib",
            "Brass/Trumpet/sus",
            "Brass/F Horn/sus",
            "Brass/Tenor Trombone/sus",
            "Brass/Tuba/sus",
            "Woodwinds/Flute/susvib",
            "Woodwinds/Clarinet/susLong",
            "Woodwinds/Oboe/Vib",
            "Woodwinds/Bassoon/sus",
        ],
    ),
}
SALAMANDER = "Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0"
VSCO = "Versilian Studios VSCO 2 Community Edition, CC0"


@dataclass
class Spec:
    id: str
    name: str
    category: str
    sustained: bool
    # (source, folder, lowest midi, highest midi) - a folder's samples are used for its range
    parts: list[tuple[str, str, int, int]]
    credit: str
    step: int = 3  # keep a root at least every `step` semitones where the library has one
    layers: int = 2  # velocity layers kept
    seconds: float = 3.0  # longest sample kept (decaying sounds fade out at the end)
    tags: list[str] = field(default_factory=list)


INSTRUMENTS = [
    Spec("grand_piano", "Grand Piano", "Piano", False, [("salamander", "Samples", 0, 127)], SALAMANDER, step=6, seconds=4.5),
    Spec(
        "string_ensemble",
        "String Ensemble",
        "Strings",
        True,
        [
            ("vsco", "Strings/Solo Contrabass/SusVib", 0, 35),
            ("vsco", "Strings/Cello Section/susvib", 36, 50),
            ("vsco", "Strings/Viola Section/susvib", 51, 57),
            ("vsco", "Strings/Violin Section/susVib", 58, 127),
        ],
        VSCO,
    ),
    Spec("trumpet", "Trumpet", "Brass", True, [("vsco", "Brass/Trumpet/sus", 0, 127)], VSCO),
    Spec("french_horn", "French Horn", "Brass", True, [("vsco", "Brass/F Horn/sus", 0, 127)], VSCO),
    Spec("trombone", "Trombone", "Brass", True, [("vsco", "Brass/Tenor Trombone/sus", 0, 127)], VSCO),
    Spec("tuba", "Tuba", "Brass", True, [("vsco", "Brass/Tuba/sus", 0, 127)], VSCO),
    Spec("flute", "Flute", "Woodwind", True, [("vsco", "Woodwinds/Flute/susvib", 0, 127)], VSCO),
    Spec("clarinet", "Clarinet", "Woodwind", True, [("vsco", "Woodwinds/Clarinet/susLong", 0, 127)], VSCO),
    Spec("oboe", "Oboe", "Woodwind", True, [("vsco", "Woodwinds/Oboe/Vib", 0, 127)], VSCO),
    Spec("bassoon", "Bassoon", "Woodwind", True, [("vsco", "Woodwinds/Bassoon/sus", 0, 127)], VSCO),
]
NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
VEL_SCALE = 1.34  # the engine opens a sampled voice's filter to cutoff * (0.55 + vel/127)


# ---------------------------------------------------------------- building the library


def fetch_sources(src_root: str) -> None:
    for key, (url, folders) in SOURCES.items():
        dest = os.path.join(src_root, key)
        if os.path.isdir(os.path.join(dest, ".git")):
            continue
        subprocess.run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", url, dest], check=True)
        subprocess.run(["git", "-C", dest, "sparse-checkout", "set", "--no-cone", *[f"/{f}/" for f in folders]], check=True)


def parse_name(fname: str) -> tuple[int, int] | None:
    """(midi as named, velocity layer) from a sample file name, or None."""
    stem = os.path.splitext(fname)[0]
    m = re.fullmatch(r"([A-G]#?)(\d)v(\d+)", stem)  # Salamander: A0v12
    if m:
        return 12 * (int(m.group(2)) + 1) + NOTE[m.group(1)], int(m.group(3))
    if re.search(r"_(rr|RR)([2-9])|_[2-9]$|_[2-9]_", stem):
        return None  # keep the first round robin only
    notes = re.findall(r"(?<![A-Za-z])([A-G]#?)(-?\d)(?![0-9])", stem)
    vel = re.search(r"_v(\d+)", stem)
    if not notes:
        return None
    n, o = notes[-1]
    return 12 * (int(o) + 1) + NOTE[n], int(vel.group(1)) if vel else 1


def load(path: str) -> np.ndarray:
    import soundfile as sf
    from scipy.signal import resample_poly

    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = x.T
    if x.shape[0] == 1:
        x = np.vstack([x, x])
    x = x[:2]
    if sr != SR:
        from math import gcd

        g = gcd(SR, sr)
        x = resample_poly(x, SR // g, sr // g, axis=1).astype(np.float32)
    return x


def measured_midi(x: np.ndarray, named: int) -> float | None:
    import librosa

    y = mono(x)[: int(1.5 * SR)]
    f0, voiced, _ = librosa.pyin(y, fmin=librosa.midi_to_hz(max(12, named - 20)), fmax=librosa.midi_to_hz(min(120, named + 20)), sr=SR, frame_length=4096)
    ok = voiced & np.isfinite(f0)
    if ok.sum() < 5:
        return None
    return float(np.median(librosa.hz_to_midi(f0[ok])))


def trim_onset(x: np.ndarray) -> np.ndarray:
    env = np.abs(mono(x))
    hit = np.flatnonzero(env > 0.03 * env.max())
    a = max(0, int(hit[0]) - int(0.003 * SR)) if len(hit) else 0
    return x[:, a:]


def build_instrument_files(spec: Spec, src_root: str, out_root: str) -> dict:
    from .sounds import bake_loop, find_loop

    files: dict[tuple[int, int], str] = {}
    for source, folder, lo, hi in spec.parts:
        d = os.path.join(src_root, source, folder)
        named = []
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith((".wav", ".flac")):
                continue
            p = parse_name(f)
            if p:
                named.append((p[0], p[1], os.path.join(d, f)))
        if not named:
            continue
        # Libraries disagree on octave numbering: settle it by listening to a few samples.
        offs = []
        for midi, _, path in named[:: max(1, len(named) // 6)][:6]:
            m = measured_midi(load(path), midi)
            if m is not None:
                offs.append(12 * round((m - midi) / 12))
        off = int(np.median(offs)) if offs else 0
        for midi, vel, path in named:
            midi += off
            if lo <= midi <= hi and (midi, vel) not in files:
                files[(midi, vel)] = path
    roots = sorted({m for m, _ in files})
    kept: list[int] = []
    for r in roots:
        if not kept or r - kept[-1] >= spec.step or r == roots[-1]:
            kept.append(r)
    os.makedirs(os.path.join(out_root, spec.id), exist_ok=True)
    zones = []
    raw: list[tuple[int, int, np.ndarray, int]] = []
    for r in kept:
        vels = sorted(v for m, v in files if m == r)
        pick = sorted({vels[round((len(vels) - 1) * 0.55)], vels[-1]}) if spec.layers >= 2 else [vels[-1]]
        for layer, v in enumerate(pick):
            x = trim_onset(load(files[(r, v)]))
            x = x[:, : int(spec.seconds * SR)]
            raw.append((r, layer if len(pick) > 1 else 1, x, v))
    # One gain for the whole instrument keeps the library's own balance between notes.
    top = [rms(mono(x[:, int(0.05 * SR) : int(1.0 * SR)])) for r, layer, x, _ in raw if layer == 1]
    gain = 10 ** (-16 / 20) / max(1e-6, float(np.median(top)))
    peak = max(float(np.abs(x).max()) for *_, x, _ in [(a, b, c, d) for a, b, c, d in raw])
    gain = min(gain, 0.97 / max(1e-6, peak))
    for r, layer, x, v in raw:
        x = (x * gain).astype(np.float32)
        loop = None
        if spec.sustained:
            pts = find_loop(mono(x), int(0.45 * SR), x.shape[1] - int(0.1 * SR), r)
            if pts:
                x = bake_loop(x, *pts)
                loop = [int(pts[0]), int(pts[1]) - 1]
        if loop is None:
            fo = min(int(0.6 * SR), x.shape[1] // 3)
            x[:, x.shape[1] - fo :] *= np.linspace(1, 0, fo)[None, :] ** 2
        fname = f"{spec.id}_{r:03d}_{layer}.wav"
        write_wav(os.path.join(out_root, spec.id, fname), x)
        zones.append({"root": r, "layer": layer, "file": fname, "loop": loop, "frames": int(x.shape[1])})
    return {
        "name": spec.name,
        "category": spec.category,
        "sustained": spec.sustained,
        "credit": spec.credit,
        "zones": zones,
        "bytes": sum(os.path.getsize(os.path.join(out_root, spec.id, z["file"])) for z in zones),
    }


def build_library(src_root: str, out_root: str, log=print) -> dict:
    fetch_sources(src_root)
    os.makedirs(out_root, exist_ok=True)
    index = {"version": LIB_VERSION, "instruments": {}}
    for spec in INSTRUMENTS:
        log(f"building {spec.id}")
        index["instruments"][spec.id] = build_instrument_files(spec, src_root, out_root)
        log(f"  {len(index['instruments'][spec.id]['zones'])} zones, {index['instruments'][spec.id]['bytes'] / 1e6:.1f} MB")
    with open(os.path.join(out_root, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=1)
    return index


# ---------------------------------------------------------------- matching a song's sound


def load_index(lib_root: str) -> dict | None:
    try:
        with open(os.path.join(lib_root, "index.json"), encoding="utf-8") as fh:
            idx = json.load(fh)
        return idx if idx.get("version") == LIB_VERSION else None
    except (OSError, ValueError):
        return None


def categories(index: dict | None) -> set[str]:
    return {i["category"] for i in (index or {}).get("instruments", {}).values()}


def _zone_audio(lib_root: str, inst_id: str, inst: dict, pitch: int) -> tuple[np.ndarray, int]:
    import soundfile as sf

    zs = [z for z in inst["zones"] if z["layer"] == 1] or inst["zones"]
    z = min(zs, key=lambda z: abs(z["root"] - pitch))
    y, _ = sf.read(os.path.join(lib_root, inst_id, z["file"]), dtype="float32", always_2d=True)
    return y.mean(1), z["root"]


def _shift(y: np.ndarray, semis: float) -> np.ndarray:
    """Play y `semis` semitones higher the way a sampler does (resampling)."""
    import librosa

    if abs(semis) < 1e-3:
        return y
    return librosa.resample(y, orig_sr=SR * 2 ** (semis / 12), target_sr=SR).astype(np.float32)


def _centroid(y: np.ndarray) -> float:
    import librosa

    seg = y[int(0.05 * SR) : int(1.2 * SR)]
    if len(seg) < 2048:
        return 0.0
    c = librosa.feature.spectral_centroid(y=seg, sr=SR, n_fft=4096, hop_length=1024)[0]
    loud = librosa.feature.rms(y=seg, frame_length=4096, hop_length=1024)[0]
    w = loud[: len(c)]
    return float(np.sum(c * w) / max(1e-9, w.sum()))


def match(category: str, notes: list[tuple[int, np.ndarray]], lib_root: str, index: dict) -> dict | None:
    """The library instrument of `category` that sounds most like the song's notes
    [(midi, mono audio)], and a filter cutoff bringing its brightness to the song's."""
    from scipy.signal import butter, sosfilt

    from .evaluate import timbre_features

    cands = {k: v for k, v in index["instruments"].items() if v["category"] == category}
    if not cands or not notes:
        return None
    notes = notes[:8]
    best = None
    for inst_id, inst in cands.items():
        sims, pairs = [], []
        for pitch, y in notes:
            ly, root = _zone_audio(lib_root, inst_id, inst, pitch)
            if abs(pitch - root) > 7:
                continue  # outside the instrument's range: it cannot be this one
            ly = _shift(ly, pitch - root)
            sims.append(float(timbre_features(y) @ timbre_features(ly)))
            pairs.append((y, ly))
        if len(sims) < max(1, len(notes) // 2):
            continue
        score = float(np.mean(sims))
        if best is None or score > best[1]:
            best = (inst_id, score, pairs)
    if best is None:
        return None
    inst_id, score, pairs = best
    # Brightness: a darker song part gets the library sound's filter closed to match.
    cs = [(_centroid(a), _centroid(b)) for a, b in pairs]
    cs = [(a, b) for a, b in cs if a > 0 and b > 0]
    cutoff = None
    if cs:
        target = float(np.exp(np.mean([np.log(a / b) for a, b in cs])))
        if target < 0.9:
            best_fc, best_err = None, 9.0
            for fc in np.geomspace(2500, 16000, 28):
                sos = butter(2, fc, btype="low", fs=SR, output="sos")
                r = float(np.exp(np.mean([np.log(max(1.0, _centroid(sosfilt(sos, b).astype(np.float32))) / _centroid(b)) for _, b in pairs])))
                err = abs(np.log(r / target))
                if err < best_err:
                    best_fc, best_err = fc, err
            cutoff = best_fc
    return {"id": inst_id, "score": round(score, 3), "cutoff": cutoff}


def write_sfz(inst_id: str, inst: dict, name: str, category: str, cutoff: float | None, outdir: str, base: str) -> dict:
    """A song's .sfz pointing at the shared library samples (downloaded once)."""
    zones = sorted(inst["zones"], key=lambda z: (z["root"], z["layer"]))
    roots = sorted({z["root"] for z in zones})
    lines = [
        f"// ArrangerBox AI: {inst['name']} matched to the song. Samples: {inst['credit']}",
        "<control>",
        "<global>",
        f"global_label={name}",
        f"ab_category={category}",
        "<group>",
        f"ampeg_attack=0.002 ampeg_release={0.3 if inst['sustained'] else 0.45}",
    ]
    if cutoff:
        lines.append(f"cutoff={int(cutoff / VEL_SCALE)}")
    files = []
    spans = []
    layers = sorted({z["layer"] for z in zones})
    for k, r in enumerate(roots):
        lo = 21 if k == 0 else (roots[k - 1] + r) // 2 + 1
        hi = 108 if k == len(roots) - 1 else (r + roots[k + 1]) // 2
        lo, hi = min(lo, r), max(hi, r)
        spans.append({"root": r, "lo": lo, "hi": hi, "tune": 0, "loop": inst["sustained"], "seconds": 0})
        for z in [z for z in zones if z["root"] == r]:
            if len(layers) > 1:
                lovel, hivel = (0, 90) if z["layer"] == 0 else (91, 127)
            else:
                lovel, hivel = 0, 127
            op = f"sample=../lib/{inst_id}/{z['file']} lokey={lo} hikey={hi} lovel={lovel} hivel={hivel} pitch_keycenter={r}"
            if z["loop"]:
                op += f" loop_mode=loop_continuous loop_start={z['loop'][0]} loop_end={z['loop'][1]}"
            else:
                op += " loop_mode=no_loop"
            if cutoff:
                op += f" cutoff={int(cutoff / VEL_SCALE)}"
            lines += ["<region>", op]
            files.append(f"lib/{inst_id}/{z['file']}")
    sfz = base + ".sfz"
    with open(os.path.join(outdir, sfz), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return {
        "name": name,
        "category": category,
        "file": sfz,
        "sustained": inst["sustained"],
        "zones": spans,
        "range": [21, 108],
        "files": [sfz] + files,
        "source": "library",
        "library": inst["name"],
        "credit": inst["credit"],
    }
