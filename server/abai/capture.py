"""Capture one note of an instrument from a song's recording, cleanly.

A note cut straight out of a separated stem still carries the drums, other instruments
and other notes ringing under it, and it stops when the song's next note starts. Here:

1. The note's own harmonics are tracked frame by frame in the recording (fundamental
   with vibrato, and string inharmonicity for pianos and guitars).
2. A soft mask keeps only the time-frequency points on those harmonics (plus the attack
   and a faint noise floor, so hammer, pick, bow and breath stay) and the rest of the mix
   is removed. What remains is the instrument's real recorded tone and movement.
3. Where the song cut the note short, every harmonic continues from its measured level
   and phase with the decay rate it was measured to have, so a piano note rings out
   naturally instead of stopping (sustained sounds are continued steadily for looping).
"""

from __future__ import annotations

import numpy as np

from .common import SR

HOP = 256


def _nfft(f0: float) -> int:
    return 8192 if f0 < 180 else 4096


def _interp_mag(mag: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Magnitude at fractional bins b (frame-wise, linear)."""
    b = np.clip(b, 0, mag.shape[0] - 2)
    i = b.astype(int)
    w = b - i
    cols = np.arange(mag.shape[1])[None, :] if mag.ndim == 2 and b.ndim == 2 else None
    if cols is not None:
        return mag[i, cols] * (1 - w) + mag[i + 1, cols] * w
    return mag[i] * (1 - w) + mag[i + 1] * w


def track(y: np.ndarray, f0: float, inharmonic: bool) -> dict:
    """Harmonic track of a single note in mono audio y (starting at its onset)."""
    import librosa

    n_fft = _nfft(f0 / 2)
    X = librosa.stft(y, n_fft=n_fft, hop_length=HOP, window="hann", center=True)
    mag = np.abs(X)
    bin_hz = SR / n_fft
    sub = False
    if not inharmonic:
        # Organs (16' and 5 1/3' stops) and some synths sound partials below and between
        # the note's harmonics: then track on half the note's frequency.
        avg = mag[:, 2 : max(3, min(mag.shape[1], int(0.8 * SR / HOP)))].mean(1)
        on = float(_interp_mag(avg, np.array([f0 / bin_hz]))[0])
        half = float(max(_interp_mag(avg, np.array([0.5 * f0 / bin_hz, 1.5 * f0 / bin_hz]))))
        base = np.median(avg)
        if half > 0.2 * on and half > 8 * base:
            sub = True
            f0 = f0 / 2
    K = int(min(80, (SR * 0.45) / f0))
    k = np.arange(1, K + 1)
    frames = mag.shape[1]
    strong = slice(min(2, frames - 1), max(3, min(frames, int(0.6 * SR / HOP))))

    # String inharmonicity: f_k = k f0 sqrt(1 + B k^2) (0 for winds, bowed strings, organs).
    B = 0.0
    if inharmonic:
        best = -1.0
        for b_try in np.concatenate([[0.0], np.geomspace(2e-5, 3e-3, 24)]):
            bins = (k * f0 * np.sqrt(1 + b_try * k**2)) / bin_hz
            ok = bins < mag.shape[0] - 2
            s = float(_interp_mag(mag[:, strong].mean(1), bins[ok]).sum())
            if s > best:
                best, B = s, float(b_try)
    stretch = np.sqrt(1 + B * k**2)

    # Fundamental per frame (vibrato, drift): best of +-35 cents on the first harmonics.
    cents = np.arange(-35, 36, 2.5)
    kk = k[: min(8, K)]
    cand = f0 * 2 ** (cents[:, None] / 1200) * kk[None, :] * stretch[: len(kk)][None, :] / bin_hz  # (C, k)
    f0t = np.empty(frames)
    for t in range(frames):
        sc = _interp_mag(mag[:, t], cand.ravel()).reshape(cand.shape).sum(1)
        f0t[t] = f0 * 2 ** (cents[int(np.argmax(sc))] / 1200)
    f0t = np.convolve(np.pad(f0t, 3, mode="edge"), np.ones(7) / 7, mode="valid")  # smooth jitter

    # Each harmonic: refine to the local spectral peak (parabolic), keep amplitude and phase.
    pred = (f0t[None, :] * (k * stretch)[:, None]) / bin_hz  # (K, T) fractional bins
    width = np.maximum(1.0, 0.25 * f0 / bin_hz)
    amp = np.zeros_like(pred)
    pos = np.zeros_like(pred)
    ph = np.zeros_like(pred)
    for t in range(frames):
        col = mag[:, t]
        for j in range(K):
            c = pred[j, t]
            lo, hi = int(max(1, c - width)), int(min(len(col) - 2, c + width))
            if hi <= lo:
                pos[j, t] = c
                continue
            i = lo + int(np.argmax(col[lo : hi + 1]))
            a, b_, d = np.log(col[i - 1] + 1e-12), np.log(col[i] + 1e-12), np.log(col[i + 1] + 1e-12)
            den = a - 2 * b_ + d
            off = 0.5 * (a - d) / den if den != 0 else 0.0
            off = float(np.clip(off, -0.5, 0.5))
            pos[j, t] = i + off
            amp[j, t] = np.exp(b_ - 0.25 * (a - d) * off)
            ph[j, t] = float(np.angle(X[i, t]))
    # How wide each harmonic really is (a string section, chorus or vibrato is wider than
    # one steady tone): keep that width, it is part of the sound.
    avg = mag[:, strong].mean(1)
    widths = []
    for j in range(min(8, K)):
        c = int(round(np.median(pos[j, strong])))
        if c < 3 or c > len(avg) - 4 or avg[c] <= 0:
            continue
        half = avg[c] / 2
        lo = c
        while lo > 0 and avg[lo] > half and c - lo < 40:
            lo -= 1
        hi = c
        while hi < len(avg) - 1 and avg[hi] > half and hi - c < 40:
            hi += 1
        widths.append(hi - lo)
    sigma = float(np.clip((np.median(widths) if widths else 2.0) / 2.355 * 1.3, 1.4, 8.0))
    return {"X": X, "n_fft": n_fft, "pos": pos, "amp": amp, "phase": ph, "f0": f0t, "B": B, "K": K, "sigma": sigma, "sub": sub}


def mask_note(x: np.ndarray, tr: dict, attack_s: float = 0.03, floor: float = 0.04) -> np.ndarray:
    """Keep the tracked harmonics of x (channels, n): the instrument's own sound only."""
    import librosa

    n_fft = tr["n_fft"]
    nb = n_fft // 2 + 1
    T = tr["pos"].shape[1]
    bins = np.arange(nb)[:, None]
    M = np.zeros((nb, T), dtype=np.float32)
    sigma = tr["sigma"]
    floor_db = np.log(tr["amp"].max() + 1e-12)
    for j in range(tr["K"]):
        # Harmonics that are not really there (far below the note's level) are not kept.
        live = (np.log(tr["amp"][j] + 1e-12) > floor_db - 9.0).astype(np.float32)
        if not live.any():
            continue
        M = np.maximum(M, np.exp(-0.5 * ((bins - tr["pos"][j][None, :]) / sigma) ** 2).astype(np.float32) * live[None, :])
    att = int(attack_s * SR / HOP) + 2
    M[:, :att] = np.maximum(M[:, :att], np.linspace(0.85, 0.0, att)[None, :] ** 1.5)
    M = np.maximum(M, floor)
    out = []
    for ch in range(x.shape[0]):
        Xc = librosa.stft(x[ch], n_fft=n_fft, hop_length=HOP, window="hann", center=True)
        Xc = Xc[:, :T] * M[:, : Xc.shape[1]]
        out.append(librosa.istft(Xc, hop_length=HOP, window="hann", center=True, length=x.shape[1]))
    return np.stack(out).astype(np.float32)


def continue_note(clean: np.ndarray, tr: dict, from_s: float, total_s: float, sustained: bool) -> np.ndarray:
    """Extend a note past `from_s` (where the song cut it short) to `total_s`, every
    harmonic carrying on from its measured level and phase; decaying sounds keep their
    measured decay rate per harmonic, sustained ones hold. Crossfaded into the recording."""
    T = tr["amp"].shape[1]
    tf = min(T - 1, int(from_s * SR / HOP))
    if tf < 4 or total_s <= from_s + 0.05:
        return clean
    amp, pos, ph = tr["amp"], tr["pos"], tr["phase"]
    n_fft = tr["n_fft"]
    win_gain = n_fft / 4.0  # Hann window: peak magnitude = amplitude * N / 4
    peak_t = int(np.argmax(amp.sum(0)[: max(2, tf)]))
    t_fit = np.arange(peak_t + int(0.06 * SR / HOP), tf)
    rates = np.zeros(tr["K"])
    for j in range(tr["K"]):
        a = amp[j, t_fit]
        good = a > amp[j, peak_t] * 1e-3
        if not sustained and good.sum() >= 6:
            slope = np.polyfit(t_fit[good] * HOP / SR, np.log(a[good] + 1e-12), 1)[0]
            rates[j] = float(np.clip(slope, -12.0, -0.15))  # per second, natural log
        elif not sustained:
            rates[j] = np.nan
    if not sustained:
        fill = np.nanmedian(rates) if np.isfinite(rates).any() else -1.2
        rates = np.where(np.isfinite(rates), rates, fill * (1 + 0.04 * np.arange(tr["K"])))
    start = tf * HOP  # frame centre (centered STFT)
    n = int(total_s * SR) - start
    if n <= 0:
        return clean
    t = np.arange(n) / SR
    syn = np.zeros(n)
    for j in range(tr["K"]):
        a0 = amp[j, tf] / win_gain
        if a0 <= 0:
            continue
        f = pos[j, tf] * SR / n_fft
        if f >= SR * 0.45:
            continue
        env = a0 * np.exp(rates[j] * t) if not sustained else a0
        syn += env * np.cos(2 * np.pi * f * t + ph[j, tf])
    out = np.zeros((clean.shape[0], int(total_s * SR)), dtype=np.float32)
    out[:, : min(clean.shape[1], out.shape[1])] = clean[:, : out.shape[1]]
    xf = min(int(0.12 * SR), n, max(0, clean.shape[1] - start))
    if xf > 8:
        w = np.linspace(0, np.pi / 2, xf)
        # Each channel continues at its own level.
        for ch in range(out.shape[0]):
            seg = clean[ch, start : start + xf]
            ref = np.sqrt(np.mean(seg**2)) / max(1e-9, np.sqrt(np.mean(syn[:xf] ** 2)))
            s = syn * ref
            out[ch, start : start + xf] = seg * np.cos(w) + s[:xf] * np.sin(w)
            out[ch, start + xf :] = s[xf : xf + out.shape[1] - start - xf]
    else:
        out[:, start:] = syn[None, : out.shape[1] - start]
    return out


def capture(x: np.ndarray, f0: float, note_s: float, sustained: bool, inharmonic: bool, total_s: float) -> tuple[np.ndarray, dict]:
    """x: (channels, n) audio from just before the onset to where the song moved on.
    Returns the clean note, extended to total_s when the song cut it short."""
    from .common import mono

    tr = track(mono(x), f0, inharmonic)
    clean = mask_note(x, tr)
    if clean.shape[1] / SR < total_s - 0.05:
        # Continue from shortly before the recording ends (the last frames hold the
        # next note's onset or the cut).
        from_s = max(0.15, min(note_s, clean.shape[1] / SR) - 0.08)
        clean = continue_note(clean[:, : int(from_s * SR) + int(0.12 * SR)], tr, from_s, total_s, sustained)
    info = {"B": round(tr["B"], 6), "sigma": round(tr["sigma"], 2), "sub": tr["sub"], "harmonics": int((tr["amp"].max(1) > tr["amp"].max() * 1e-2).sum())}
    return clean, info
