"""Onset accuracy against notes whose first sample is known exactly.

Run: uv run -p 3.12 --with numpy --with scipy python server/tests/test_onsets.py
     (AB_SEED=n for another random set)

Each case is a short phrase of synthetic notes (random pitch, phase and loudness). Basic
Pitch's guess is simulated as the truth plus up to +-25 ms of error, then refine() must find
the first sample. Pass rules:
  every note marked exact is within 1 ms (no false "exact"), median within 0.1 ms (5+ notes)
  at least 90 % of the truly isolated notes (35 dB clear, no neighbour) are marked exact
  soft attacks (separate swells): the cut is never after the first sample, at most 30 ms before
    (swells fade in over 40-200 ms; erring early only adds a little near-silence)
  pad (overlapping swells): never marked exact
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from abai.onsets import refine  # noqa: E402

SR = 44100
rng = np.random.default_rng(int(os.environ.get("AB_SEED", 7)))


def tone(f0: float, n: int, attack_s: float, decay_s: float, inharm: float = 0.0, partials: int = 8) -> np.ndarray:
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, partials + 1):
        fk = f0 * k * np.sqrt(1 + inharm * k * k)
        if fk > SR / 2.2:
            break
        y += (0.7**k) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 2 * np.pi))
    env = np.exp(-t / decay_s) if decay_s > 0 else np.ones(n)
    if attack_s > 0:
        env *= np.minimum(1.0, t / attack_s)
    # Natural 60 ms release at the end (a hard stop would be a click: a fake attack).
    rel = min(n, int(0.06 * SR))
    env[n - rel :] *= np.cos(np.linspace(0, np.pi / 2, rel)) ** 2
    return y * env


def phrase(kind: str, count: int = 24):
    """Returns (signal, [(onset_sample, midi)])."""
    n = int(SR * (count * 0.35 + 1.0))
    x = np.zeros(n)
    truth = []
    pos = int(0.3 * SR)
    for i in range(count):
        midi = int(rng.integers(40, 90))
        f0 = 440 * 2 ** ((midi - 69) / 12)
        vel = 10 ** (rng.uniform(-18, 0) / 20)
        if kind == "damped":  # the player stops each note before the next
            att, dec = rng.uniform(0.0, 0.002), rng.uniform(0.05, 0.08)
        elif kind in ("pluck", "legato", "repeat", "bleed", "chords"):
            att, dec = rng.uniform(0.0, 0.002), rng.uniform(0.3, 1.5)
        elif kind == "mallet":
            att, dec = 0.0, rng.uniform(0.08, 0.3)
        else:  # soft / pad: swells that sustain
            att, dec = rng.uniform(0.04, 0.2), 0.0
        if kind == "repeat" and i % 2 == 1:
            midi, f0 = truth[-1][1], 440 * 2 ** ((truth[-1][1] - 69) / 12)
        L = min(n - pos, int(SR * (0.22 if kind == "soft" else 2.5)))  # soft: released before the next
        x[pos : pos + L] += vel * tone(f0, L, att, dec, inharm=0.0004 if kind == "pluck" else 0.0)
        truth.append((pos, midi))
        if kind == "chords":
            for iv in (4, 7):
                f = f0 * 2 ** (iv / 12)
                d = int(rng.integers(0, int(0.02 * SR)))
                x[pos + d : pos + d + L - d] += vel * 0.7 * tone(f, L - d, att, dec)
                truth.append((pos + d, midi + iv))
        gap = rng.uniform(0.12, 0.25) if kind in ("legato", "repeat") else rng.uniform(0.25, 0.45)
        pos += int(gap * SR)
        if pos > n - SR:
            break
    x += 10 ** (-62 / 20) * rng.standard_normal(n)  # noise floor
    if kind == "bleed":
        # Another instrument underneath: a sustained chord at -20 dB with vibrato.
        t = np.arange(n) / SR
        for f in (130.8, 164.8, 196.0):
            x += 0.1 * np.sin(2 * np.pi * f * t + 3 * np.sin(2 * np.pi * 5 * t))
    truth.sort()
    return x.astype(np.float32), truth


CROWD_S = 0.025


def run_case(kind: str):
    x, truth = phrase(kind)
    rows = []
    for idx, (s, m) in enumerate(truth):
        coarse = s / SR + rng.uniform(-0.025, 0.025)
        prev = truth[idx - 1][0] / SR + 0.004 if idx else 0.0
        crowded = any(abs(t - s) < CROWD_S * SR for j, (t, _) in enumerate(truth) if j != idx)
        o = refine(x, SR, coarse, earliest=max(0.0, min(prev, coarse - 0.002)), crowded=crowded, midi=m)
        # Truly isolated: what sounded in the 20 ms before is 35 dB below the note's first 20 ms.
        pre = x[max(0, s - int(0.02 * SR)) : s].astype(np.float64)
        post = x[s : s + int(0.02 * SR)].astype(np.float64)
        iso = 10 * np.log10((np.mean(pre**2) + 1e-20) / (np.mean(post**2) + 1e-20)) <= -35 and not crowded
        rows.append(((o.t - s / SR) * 1000, o.exact, (o.cut - s / SR) * 1000, iso))
    r = np.array(rows, dtype=object)
    return r[:, 0].astype(float), r[:, 1].astype(bool), r[:, 2].astype(float), r[:, 3].astype(bool)


COVER = 0.9  # truly isolated notes (35 dB clear, no neighbour) that must be marked exact


def main() -> int:
    ok = True
    print(f"{'case':8} {'notes':>5} {'isol.':>5} {'exact':>6} {'median':>8} {'worst':>8} {'all p50':>8}  result   (exact: share of isolated notes marked exact)")
    for kind in ("damped", "mallet", "pluck", "legato", "repeat", "chords", "bleed", "soft", "pad"):
        e, ex, cut, iso = run_case(kind)
        if kind == "pad":  # overlapping swells: approximate only, must never be marked exact
            good = not ex.any()
            print(f"{kind:8} {len(e):5d} {'':>5} {ex.mean():6.0%} {'':>8} {'':>8} {np.median(np.abs(e)):7.3f}ms  {'PASS' if good else 'FAIL'}  (never exact)")
            ok &= good
            continue
        if kind == "soft":  # the cut must keep the whole swell: never after the first sample
            good = bool(cut.max() <= 0.0 and cut.min() >= -30.0)
            print(f"{kind:8} {len(e):5d} {'':>5} {'':>6} {'':>8} {'':>8} {np.median(e):7.3f}ms  {'PASS' if good else 'FAIL'}  (cut: latest {cut.max():+.3f} ms, earliest {cut.min():+.1f} ms)")
            ok &= good
            continue
        a = np.abs(e[ex])
        cover = ex[iso].mean() if iso.any() else 1.0  # of the truly isolated notes
        good = bool(a.size == 0 or (a.max() <= 1.0 and (a.size < 5 or np.median(a) <= 0.1)))
        good &= cover >= COVER
        ok &= good
        med = f"{np.median(a):7.3f}ms" if a.size else "      -  "
        worst = f"{a.max():7.3f}ms" if a.size else "      -  "
        print(f"{kind:8} {len(e):5d} {int(iso.sum()):5d} {cover:6.0%} {med} {worst} {np.median(np.abs(e)):7.3f}ms  {'PASS' if good else 'FAIL'}")
    print("all passed" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
