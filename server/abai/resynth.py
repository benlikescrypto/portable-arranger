"""Clean resynthesis of organ and synth sounds heard in a song.

An organ (drawbars) and most synth tones are built from steady harmonics, so measuring
those harmonics on the song's own clean notes and rebuilding them gives the same tone
on every key, without the mix's bleed, reverb or separation artifacts.
"""

from __future__ import annotations

import os

import numpy as np

from .common import SR, write_wav

# Drawbar footages as multiples of the played note: 16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1'
FOOTAGE = (0.5, 1.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0)
# Tonewheels sit on equal-tempered pitches, which gives an organ its gentle beating.
TEMPERED = tuple(float(2 ** (round(12 * np.log2(r)) / 12)) for r in FOOTAGE)


def _spectrum(seg: np.ndarray) -> tuple[np.ndarray, int]:
    body = seg[int(0.12 * SR) : int(1.4 * SR)]
    if len(body) < int(0.25 * SR):
        body = seg[: int(1.4 * SR)]
    n = 1 << int(np.log2(max(2048, min(len(body), 1 << 16))))
    frames = [body[i : i + n] * np.hanning(n) for i in range(0, max(1, len(body) - n + 1), n // 2)]
    frames = [np.pad(f, (0, n - len(f))) for f in frames]
    return np.mean([np.abs(np.fft.rfft(f)) for f in frames], axis=0), n


def _peak(mag: np.ndarray, n: int, f: float, cents: float = 30.0) -> float:
    k0 = f * n / SR
    lo, hi = int(k0 * 2 ** (-cents / 1200)), int(np.ceil(k0 * 2 ** (cents / 1200))) + 1
    if hi >= len(mag) or lo < 1:
        return 0.0
    return float(mag[lo:hi].max())


def _f0(midi: int, cents: float) -> float:
    return 440.0 * 2 ** ((midi - 69 + cents / 100.0) / 12)


def fit_drawbars(notes: list[tuple[int, float, np.ndarray]]) -> np.ndarray:
    """Drawbar levels (0..1, loudest = 1) from the song's notes [(midi, cents, audio)]."""
    rows = []
    for midi, cents, y in notes:
        mag, n = _spectrum(y)
        f = _f0(midi, cents)
        row = np.array([_peak(mag, n, f * r) for r in FOOTAGE])
        if row.max() > 0:
            rows.append(row / row.max())
    if not rows:
        return np.array([0, 0, 1, 0.8, 0, 0.6, 0, 0, 0.0])
    lv = np.median(np.stack(rows), axis=0)
    lv[lv < 0.06] = 0.0  # below a drawbar's first step: off
    return lv / max(1e-9, lv.max())


def fit_harmonics(notes: list[tuple[int, float, np.ndarray]], count: int = 40) -> np.ndarray:
    """Relative amplitude of harmonics 1..count (median over the song's notes)."""
    rows = []
    for midi, cents, y in notes:
        mag, n = _spectrum(y)
        f = _f0(midi, cents)
        row = np.array([_peak(mag, n, f * k, 25.0) if f * k < SR * 0.45 else np.nan for k in range(1, count + 1)])
        if np.nanmax(row) > 0:
            rows.append(row / np.nanmax(row))
    if not rows:
        h = 1.0 / np.arange(1, count + 1)
        return h
    h = np.nanmedian(np.stack(rows), axis=0)
    h = np.nan_to_num(h, nan=0.0)
    h[h < 0.01] = 0.0
    return h / max(1e-9, h.max())


def envelope(notes: list[tuple[int, float, np.ndarray]]) -> tuple[float, bool]:
    """(attack seconds, held notes keep their level)."""
    from .sounds import attack_time

    atk = [attack_time(y) for _, _, y in notes]
    ratios = []
    for _, _, y in notes:
        if len(y) < int(0.8 * SR):
            continue
        hop = int(0.05 * SR)
        env = np.array([np.sqrt(np.mean(y[i : i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
        pk = int(np.argmax(env))
        late = env[min(len(env) - 1, pk + int(0.6 / 0.05))]
        ratios.append(late / max(1e-9, env[pk]))
    sustained = (float(np.median(ratios)) > 0.5) if ratios else True
    return float(np.clip(np.median(atk) if atk else 0.01, 0.002, 0.6)), sustained


def _loop_len(f: float, target: float = 1.0) -> int:
    """A loop of whole periods of f, as close to an integer frame count as possible."""
    p = SR / f
    best = None
    for m in range(max(1, int(0.5 * target * f)), int(1.5 * target * f) + 1):
        err = abs(m * p - round(m * p))
        if best is None or err < best[0]:
            best = (err, int(round(m * p)))
    return best[1]


def render_organ(levels: np.ndarray, midi: int, seconds: float = 2.4) -> tuple[np.ndarray, tuple[int, int]]:
    rng = np.random.default_rng(midi)
    t = np.arange(int(seconds * SR)) / SR
    f = _f0(midi, 0.0)
    y = np.zeros_like(t)
    for lv, r in zip(levels, TEMPERED):
        if lv > 0 and f * r < SR * 0.45:
            y += lv * np.sin(2 * np.pi * f * r * t + rng.uniform(0, 2 * np.pi))
    # Key click: a few ms of soft filtered noise at the start.
    n = int(0.006 * SR)
    click = rng.standard_normal(n) * np.hanning(2 * n)[n:] * 0.04
    y[:n] += np.convolve(click, np.ones(6) / 6, mode="same")
    y *= 10 ** (-14 / 20) / max(1e-9, np.sqrt(np.mean(y**2)))
    a = int(0.3 * SR)
    return y.astype(np.float32), (a, len(y) - int(0.05 * SR))


def render_synth(h: np.ndarray, midi: int, attack: float, sustained: bool, seconds: float = 2.4) -> tuple[np.ndarray, tuple[int, int] | None]:
    rng = np.random.default_rng(1000 + midi)
    f = _f0(midi, 0.0)
    a = int(attack * SR)
    L = _loop_len(f) if sustained else 0
    n = max(int(seconds * SR), a + L + int(0.05 * SR)) if sustained else int(seconds * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, amp in enumerate(h, start=1):
        if amp > 0 and f * k < SR * 0.45:
            y += amp * np.sin(2 * np.pi * f * k * t + rng.uniform(0, 2 * np.pi))
    env = np.ones(n)
    if a > 0:
        env[:a] = np.linspace(0, 1, a) ** 1.5
    if not sustained:
        env[a:] = np.exp(-(t[a:] - t[a]) / 0.6)
    y *= env
    y *= 10 ** (-14 / 20) / max(1e-9, np.sqrt(np.mean(y[a : a + int(0.5 * SR)] ** 2)))
    if np.abs(y).max() > 0.97:
        y *= 0.97 / np.abs(y).max()
    loop = (a + int(0.02 * SR), a + int(0.02 * SR) + L) if sustained else None
    if loop:
        y = y[: loop[1] + 1]
    return y.astype(np.float32), loop


def build(kind: str, notes: list[tuple[int, float, np.ndarray]], name: str, category: str, outdir: str, base: str) -> dict | None:
    """kind 'organ' or 'synth': a clean resynthesised instrument over the keyboard."""
    from .sounds import bake_loop, find_loop

    if len(notes) < 2:
        return None
    roots = list(range(36, 97, 3))
    lines = [
        f"// ArrangerBox AI: {category} resynthesised from the song's own notes",
        "<control>",
        "<global>",
        f"global_label={name}",
        f"ab_category={category}",
        "<group>",
    ]
    files = []
    if kind == "organ":
        levels = fit_drawbars(notes)
        lines.append("ampeg_attack=0.003 ampeg_release=0.06")
        detail = {"drawbars": [int(round(8 * v)) for v in levels]}
        sustained = True
    else:
        h = fit_harmonics(notes)
        attack, sustained = envelope(notes)
        lines.append(f"ampeg_attack=0.002 ampeg_release={0.25 if sustained else 0.35}")
        detail = {"harmonics": [round(float(v), 3) for v in h[:16]], "attack": round(attack, 3)}
    for k, r in enumerate(roots):
        if kind == "organ":
            y, (ls, le) = render_organ(levels, r)
            pts = find_loop(y, ls, le, r)
            loop = None
            if pts:
                y = bake_loop(y[None, :], *pts)[0]
                loop = (pts[0], pts[1] - 1)
        else:
            y, lp = render_synth(h, r, attack, sustained)
            loop = (lp[0], lp[1] - 1) if lp else None
        fname = f"{base}_{r:03d}.wav"
        write_wav(os.path.join(outdir, fname), y)
        lo = 0 if k == 0 else r - 1
        hi = 127 if k == len(roots) - 1 else r + 1
        op = f"sample={fname} lokey={lo} hikey={hi} pitch_keycenter={r}"
        op += f" loop_mode=loop_continuous loop_start={loop[0]} loop_end={loop[1]}" if loop else " loop_mode=no_loop"
        lines += ["<region>", op]
        files.append(fname)
    sfz = base + ".sfz"
    with open(os.path.join(outdir, sfz), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return {
        "name": name,
        "category": category,
        "file": sfz,
        "sustained": sustained,
        "zones": [{"root": r, "lo": 0 if k == 0 else r - 1, "hi": 127 if k == len(roots) - 1 else r + 1, "tune": 0, "loop": sustained, "seconds": 2.4} for k, r in enumerate(roots)],
        "range": [0, 127],
        "files": [sfz] + files,
        "source": "resynth",
        **detail,
    }
