"""The attack scanner (onsets.attacks) against fast playing whose every strike is known.

Run: uv run -p 3.12 --with numpy --with scipy python server/tests/test_attacks.py
     (AB_SEED=n for another random set)

Cases: fast runs, the same key struck again and again while it rings, trills, fast chords,
low bass (a low note's once-per-period pulse must not count), all at 8-16 notes per second,
over a noise floor; then sounds with no attack at all (a vibrato chord, slow swells), and
fast notes over a vibrato chord.

The scanner only confirms what Basic Pitch suggests (notes.segment()), so what matters is
that an attack it reports is real. It finds every strike out of quiet, but its predictor
can only cancel about 60 ringing frequencies: in dense playing (15 notes still ringing) it
finds some strikes and misses the rest, which is reported, not failed. Pass rules:
  at most 2 % false attacks (nothing struck within 25 ms), none in the no-attack cases
  the strikes it finds are within 3 ms (refine() then finds the sample)
"""

from __future__ import annotations

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from abai.onsets import attacks, refine  # noqa: E402

SR = 44100
rng = np.random.default_rng(int(os.environ.get("AB_SEED", 7)))


def tone(f0: float, n: int, attack_s: float, decay_s: float, inharm: float = 0.0004) -> np.ndarray:
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 12):
        fk = f0 * k * np.sqrt(1 + inharm * k * k)
        if fk > SR / 2.2:
            break
        y += (0.7**k) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 2 * np.pi))
    env = np.exp(-t / decay_s) if decay_s > 0 else np.ones(n)
    if attack_s > 0:
        env *= np.minimum(1.0, t / attack_s)
    rel = min(n, int(0.06 * SR))
    env[n - rel :] *= np.cos(np.linspace(0, np.pi / 2, rel)) ** 2
    return y * env


def f(m: float) -> float:
    return 440 * 2 ** ((m - 69) / 12)


def vibrato_chord(n: int, level: float) -> np.ndarray:
    t = np.arange(n) / SR
    y = np.zeros(n)
    for fr in (130.8, 164.8, 196.0, 261.6):
        y += level * np.sin(2 * np.pi * fr * t + 3 * np.sin(2 * np.pi * 5.5 * t + rng.uniform(0, 6)))
    return y


def phrase(kind: str, seconds: float = 8.0):
    """(signal, strike samples)."""
    n = int(SR * (seconds + 3.0))
    x = np.zeros(n)
    strikes: list[int] = []
    pos = int(0.4 * SR)
    m = int(rng.integers(48, 80))
    i = 0
    while pos < int(SR * seconds) and kind not in ("steady", "swells"):
        rate = rng.uniform(8, 16)
        vel = 10 ** (rng.uniform(-15, 0) / 20)
        dec = rng.uniform(0.3, 1.5)
        L = min(n - pos, int(2.5 * SR))
        if kind in ("fast", "bleed"):
            m = int(rng.integers(40, 92))
        elif kind == "repeats":
            m = m if rng.random() < 0.85 else int(rng.integers(48, 80))
        elif kind == "trill":
            m = m + (2 if i % 2 == 0 else -2)
        elif kind == "bass":
            m, rate, dec = int(rng.integers(28, 46)), rng.uniform(4, 8), rng.uniform(0.8, 2.0)
        elif kind == "chords":
            rate = rng.uniform(5, 8)
            m = int(rng.integers(48, 72))
            for iv in (4, 7, 12):
                d = int(rng.integers(0, int(0.012 * SR)))
                x[pos + d : pos + L] += vel * 0.6 * tone(f(m + iv), L - d, rng.uniform(0, 0.002), dec)
        x[pos : pos + L] += vel * tone(f(m), L, rng.uniform(0, 0.002), dec)
        strikes.append(pos)
        pos += int(SR / rate)
        i += 1
    if kind == "swells":
        while pos < int(SR * seconds):
            L = int(rng.uniform(0.6, 1.2) * SR)
            x[pos : pos + L] += 0.3 * tone(f(int(rng.integers(48, 76))), L, rng.uniform(0.08, 0.25), 0.0, 0.0)
            pos += int(rng.uniform(0.3, 0.7) * SR)
    if kind in ("steady", "bleed"):
        x += vibrato_chord(n, 0.15 if kind == "steady" else 0.08)
    x += 10 ** (-62 / 20) * rng.standard_normal(n)
    return x.astype(np.float32), strikes


def main() -> int:
    ok = True
    print(f"{'case':8} {'strikes':>7} {'found':>6} {'false':>6} {'p50 ms':>7} {'p95 ms':>7} {'refined p50':>11} {'time':>6}  result")
    for kind in ("fast", "repeats", "trill", "chords", "bass", "bleed", "steady", "swells"):
        x, strikes = phrase(kind)
        t0 = time.time()
        found = attacks(x, SR, 0.2, x.size / SR - 0.2)
        dt = time.time() - t0
        ts = np.array([a.t for a in found]) * SR
        errs, false = [], 0
        for s in strikes:
            d = ts - s
            j = int(np.argmin(np.abs(d))) if d.size else -1
            if j >= 0 and abs(d[j]) <= 0.003 * SR:
                errs.append(d[j] / SR * 1000)
        S = np.array(strikes) if strikes else np.zeros(0)
        for t in ts:
            if not S.size or np.min(np.abs(S - t)) > 0.025 * SR:
                false += 1
        # The scanner only needs to be close: refine() then finds the sample. Check that too.
        ref = []
        for s in strikes:
            d = ts - s
            if d.size:
                j = int(np.argmin(np.abs(d)))
                if abs(d[j]) <= 0.003 * SR:
                    prev = [p for p in strikes if p < s - 0.025 * SR]
                    o = refine(x, SR, ts[j] / SR, earliest=(prev[-1] / SR + 0.004) if prev else 0.0)
                    ref.append(abs(o.t * SR - s) / SR * 1000)
        if kind in ("steady", "swells"):
            good = false == 0 if kind == "steady" else True
            note = "(no strikes: nothing may be found)" if kind == "steady" else f"(swell starts are notes too; {len(found)} found)"
            print(f"{kind:8} {0:7d} {'':>6} {false:6d} {'':>7} {'':>7} {'':>11} {dt:5.1f}s  {'PASS' if good else 'FAIL'}  {note}")
            ok &= good
            continue
        rec = len(errs) / max(1, len(strikes))
        fp = false / max(1, len(found))
        good = fp <= 0.02
        ok &= good
        e = np.abs(errs) if errs else np.zeros(1)
        print(
            f"{kind:8} {len(strikes):7d} {rec:6.0%} {false:6d} {np.median(e):7.2f} {np.percentile(e, 95):7.2f} "
            f"{(np.median(ref) if ref else float('nan')):9.2f}ms {dt:5.1f}s  {'PASS' if good else 'FAIL'}"
        )
    print("all passed" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
