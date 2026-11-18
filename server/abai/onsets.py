"""Sample-accurate note onsets.

Basic Pitch says which ~11.6 ms frame a note starts in. This module finds the exact sample.

Sharp attacks (hammers, plucks, mallets):
1. Whatever was sounding just before (silence, noise, earlier notes still ringing) is learned
   with a linear predictor (order 160) and predicted one sample at a time; that cancels the
   ringing notes by about 40 dB. The new note is the energy the prediction cannot explain.
2. In a +-30 ms window around Basic Pitch's guess, the steepest rise of that new energy is
   found, then the onset is walked back to the first sample that leaves the level before.
3. The cut sits 0.5 ms earlier, on a zero crossing, so the front of the attack is never lost.

Swells (strings, pads) fade in from nothing and have no first sample to trust; their onset is
where the plain level climbs out of the quiet before it, and the cut is 3 ms earlier still:
early rather than late, so the swell is kept whole.

Isolated sharp notes (what sounded before is 30 dB down) are then checked on the plain level
too: a quiet, smooth lead-in (finger noise, the soft first moment of a mallet) is easy to
predict, so the prediction error hides it, but the plain level does not. The onset moves back
to the first sample above the quiet's own peaks.

For an isolated note the part of the attack still below the quiet is estimated from how fast it
grows once it is above (a snap: nothing hidden; a gradual rise: some), and the cut goes before
it. `exact` is only set when the start is provable: sharp, isolated, under 0.25 ms hidden,
and no other note starting within 25 ms. Under other sound the first part of an
attack can hide below what is ringing; those notes get a good estimate, never "exact".
Tested on synthetic notes (server/tests/test_onsets.py) and on real instrument samples through
MP3 (notes_selftest.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SEARCH_S = 0.030  # look this far after Basic Pitch's guess ...
SEARCH_BACK_S = 0.060  # ... and this far before: a quiet lead-in (finger noise) can start well ahead of the main attack
ENV_S = 0.00025  # 0.25 ms envelope window (11 samples at 44.1 kHz)
SHARP_RISE_S = 0.008  # the note's own level is within 20 dB of its peak this soon: sharp
# (piano, marimba, e-piano: 1-6 ms; strings: 28-42 ms, measured on GeneralUser GS)


@dataclass
class Onset:
    t: float  # seconds, sample-accurate
    cut: float  # where a sample cut should start (<= t)
    coarse: float  # Basic Pitch's time
    sharp: bool
    rise_ms: float  # onset to within 20 dB of the attack peak
    snr_db: float  # attack contrast: new energy over the prediction error before it
    modelled: bool  # what was sounding before was predicted and removed
    exact: bool = False  # trustworthy to the sample: sharp, clear of what rang before, no neighbour
    clear_db: float = 0.0  # level of the quiet before the note, relative to the note (dB)


def _box(x: np.ndarray, n: int) -> np.ndarray:
    """Centered moving average (zero phase, so it does not shift the onset)."""
    if n <= 1:
        return x
    c = np.cumsum(np.concatenate(([0.0], x)))
    h = n // 2
    i = np.arange(x.size)
    lo = np.clip(i - h, 0, x.size)
    hi = np.clip(i + n - h, 0, x.size)
    return (c[hi] - c[lo]) / np.maximum(hi - lo, 1)


LPC_ORDER = 160
LPC_LAM = 1e-6  # ridge, relative to the signal energy
FIT_S = 0.120  # signal before the search window used to learn what was already sounding


def _innovation(x: np.ndarray, fit0: int, start: int, end: int) -> tuple[np.ndarray, bool]:
    """What in x[start:end] the earlier sound cannot explain.

    A linear predictor learned on x[fit0:start] predicts each sample from the ones before it.
    Notes that were already ringing (several, decaying, slightly inharmonic) are sums of
    damped sinusoids, which it follows closely (about 40 dB of cancellation measured), so
    they drop out. A new note's first samples are what it cannot predict. Predicting from
    real samples (never from earlier predictions) cannot drift."""
    seg = x[start:end].astype(np.float64)
    fit = x[fit0:start].astype(np.float64)
    p = min(LPC_ORDER, (fit.size - 1) // 4)
    if p < 4 or np.sum(fit * fit) < 1e-12:
        return seg, False
    from numpy.lib.stride_tricks import sliding_window_view

    win = sliding_window_view(fit, p + 1)  # row: x[n-p .. n]
    X, y = win[:, :p][:, ::-1], win[:, -1]  # predict x[n] from x[n-1] .. x[n-p]
    R = X.T @ X
    lam = LPC_LAM * np.trace(R) / p + 1e-12
    a = np.linalg.solve(R + lam * np.eye(p), X.T @ y)
    ctx = x[start - p : end].astype(np.float64)
    W = sliding_window_view(ctx, p + 1)[: seg.size]
    pred = W[:, :p][:, ::-1] @ a
    return seg - pred, True


EXACT_CLEAR_DB = -10.0  # something this loud was sounding: check for a swell already under way
ISOLATED_DB = -30.0  # what sounded before is this far below the note: its start is provable
SWELL_BACK_S = 0.080  # Basic Pitch places slow swells late: look further back for them


def _swell_start(x: np.ndarray, sr: int, c: int, earliest: float, pw: int) -> int | None:
    """First sample of a swell (a note that fades in): the last point where the plain level
    leaves the quiet before it, nearest Basic Pitch's guess. Errs early, never late, so the
    swell is kept whole."""
    n = x.size
    lo = max(int(earliest * sr), c - int(SWELL_BACK_S * sr), 0)
    hi = min(n, c + int(0.250 * sr))
    if hi - lo < int(0.010 * sr):
        return None
    seg = x[lo:hi].astype(np.float64)
    P = _box(seg * seg, pw) + 1e-14
    k = c - lo
    floor = float(np.percentile(P[: max(8, k + int(0.025 * sr))], 10))
    quiet = P <= floor * 2.0  # within 3 dB of the quiet level
    # Quiet-to-rising transitions that go on to swell at least 12 dB over the quiet level.
    starts = np.nonzero(quiet[:-1] & ~quiet[1:])[0] + 1
    good = []
    for i in starts:
        if i > k + int(0.060 * sr):
            break
        nxt = np.nonzero(quiet[i:])[0]
        end = i + (int(nxt[0]) if nxt.size else P.size - i)
        if P[i:end].max() > floor * 10 ** 1.2:
            good.append(int(i))
    if not good:
        return None
    return lo + min(good, key=lambda i: abs(i - k))


def refine(x: np.ndarray, sr: int, coarse: float, earliest: float = 0.0, crowded: bool = False, midi: float | None = None) -> Onset:
    """Exact onset for a note Basic Pitch placed at `coarse` seconds in mono signal x.

    `earliest`: do not look before this (just after the previous note's onset).
    `crowded`: another note starts within 25 ms, so this attack could be its; the
    onset is still found but never marked exact.
    `midi`: the note's pitch; level measurements then span at least one period, so a low
    note's waveform swings are not mistaken for attacks."""
    n = x.size
    c = int(round(coarse * sr))
    lo = max(int(earliest * sr), c - int(SEARCH_BACK_S * sr), 1)
    hi = min(c + int(SEARCH_S * sr), n - 1)
    if hi - lo < 16:
        t = coarse
        return Onset(t, t, coarse, False, 0.0, 0.0, False)
    w = max(3, int(round(ENV_S * sr)))

    fit0 = max(0, int(earliest * sr) if earliest > 0 else 0, lo - int(FIT_S * sr))
    if lo - fit0 < int(0.008 * sr):  # too little history: fall back to a longer, older one
        fit0 = max(0, lo - int(0.008 * sr))
    res, modelled = _innovation(x, fit0, lo, min(n, hi + int(0.025 * sr)))
    le = 20 * np.log10(np.sqrt(_box(res * res, w)) + 1e-9)
    # Steepest rise: level over the next 1.5 ms minus level over the previous 1.5 ms.
    d = max(2, int(0.0015 * sr))
    smooth = 20 * np.log10(np.sqrt(_box(res * res, d)) + 1e-9)
    m = hi - lo
    idx = np.arange(d, m)
    rise = smooth[np.minimum(idx + d, smooth.size - 1)] - smooth[idx - d]
    # Mild preference for Basic Pitch's guess so a later, unrelated attack does not win.
    rise = rise - 2.0 * np.abs((idx + lo - c) / (SEARCH_S * sr))
    k = int(idx[int(np.argmax(rise))])

    # Floor: what the residual looked like before this attack (the window's quiet start).
    peak = float(np.max(le[k : min(le.size, k + int(0.010 * sr))]))
    # The quietest part of the window before the attack (a lead-in must not raise it).
    pre_le = le[: max(1, k - int(0.002 * sr))]
    floor = float(np.percentile(pre_le, 25)) if pre_le.size >= 8 else float(np.min(le[: k + 1]))
    spread = float(np.percentile(pre_le, 75) - floor) if pre_le.size >= 8 else 0.0
    snr = peak - floor
    th = floor + max(spread + 3.0, 0.08 * snr)
    # The steepest rise can sit just before the attack: step forward to where the new energy
    # clears the threshold, then walk back to the first sample of the run above it.
    j = k
    limit = min(le.size - 1, k + int(0.004 * sr))
    while j < limit and le[j] <= th:
        j += 1
    while j > 0 and le[j - 1] > th:
        j -= 1
    onset = lo + j
    # The 0.25 ms envelope rises half a window before the first new sample: undo that bias
    # by walking forward to the first sample whose own magnitude clears the floor.
    amp_th = 10 ** (th / 20)
    for q in range(j, min(j + w, res.size)):
        if abs(res[q]) > amp_th:
            onset = lo + q
            break

    # Sharpness from how fast the new note's own level rises above what was already sounding:
    # plain signal power (3 ms) minus the power just before the onset.
    period = int(sr / (440.0 * 2 ** ((midi - 69) / 12))) if midi else 0
    pw = max(int(0.003 * sr), period + 1)
    e_pre = float(np.mean(x[max(0, onset - int(0.020 * sr)) : max(1, onset - int(0.001 * sr))].astype(np.float64) ** 2)) + 1e-14
    post = x[onset : min(n, onset + int(0.080 * sr))].astype(np.float64)
    rise_ms, pre_post_db = 0.0, 0.0
    if post.size > pw:
        lvl = np.sqrt(np.maximum(_box(post * post, pw) - e_pre, 0.0))
        top = float(lvl.max())
        hit = np.nonzero(lvl >= 0.1 * top)[0]  # within 20 dB of the attack peak
        rise_ms = 1000.0 * (int(hit[0]) if hit.size else post.size) / sr
        pre_post_db = 10 * np.log10(e_pre / (float(np.mean(post[: int(0.020 * sr)] ** 2)) + 1e-14))
    sharp = rise_ms <= SHARP_RISE_S * 1000 and snr >= 12.0

    if sharp and pre_post_db > EXACT_CLEAR_DB:
        # Something was already sounding. If it rose out of quiet shortly before, this
        # "attack" is a swing inside a note that began earlier (a low swell): use that start.
        s0 = _swell_start(x, sr, onset, earliest, pw)
        if s0 is not None and onset - int(0.060 * sr) <= s0 < onset - int(0.002 * sr):
            sharp = False
    if not sharp:
        s0 = _swell_start(x, sr, c, earliest, pw)
        # No quiet before it (it fades in under other notes): its start is hidden. Basic Pitch
        # hears swells late, so fall back well before its guess: early, never late.
        onset = s0 if s0 is not None else max(int(earliest * sr), min(onset, c - int(SWELL_BACK_S * sr)), 0)

    # Isolation, on the plain level: the quiet before the note against the note's first 20 ms.
    # Only an isolated note's start can be proven; under other sound the first part of an
    # attack can hide below what is ringing, however well that is predicted.
    lo_iso = max(int(earliest * sr), onset - int(SEARCH_BACK_S * sr), 0)
    w1 = max(int(0.001 * sr), period)
    span = x[lo_iso : min(n, onset + int(0.080 * sr))].astype(np.float64)
    Pl = _box(span * span, w1) + 1e-20
    q = onset - lo_iso
    quiet_end = max(8, q - int(0.002 * sr))
    F = float(np.percentile(Pl[:quiet_end], 25)) if q > 8 else float(Pl[: max(1, q)].min())
    # Against the note's own peak level (10 ms) in its first 80 ms: a swell is still quiet at first.
    after = span[q:]
    post_p = float(np.max(_box(after * after, int(0.010 * sr)))) + 1e-20 if after.size > int(0.010 * sr) else 1e-20
    iso_db = 10 * np.log10(F / post_p)
    hidden = hidden_safe = None  # isolated notes: estimated part of the attack below the quiet (samples)
    if iso_db <= ISOLATED_DB:
        # A quiet lead-in (finger noise, the soft first moment of a mallet) is smooth, so the
        # prediction error hides it; the plain level does not. Walk back to where the level
        # leaves the quiet, then to the first sample above the quiet's own peaks (t1).
        while q > 0 and Pl[q - 1] > 4.0 * F:
            q -= 1
        quiet = span[: max(1, q - w1)]
        amp_th = max(2.0 * float(np.percentile(np.abs(quiet), 99)) if quiet.size >= 8 else 2.0 * np.sqrt(F), 1e-7)
        # The last stretch (a period, at least 1 ms) where the signal's peaks stay under the
        # threshold, before the onset; t1 is the first sample above it after that stretch.
        from scipy.ndimage import maximum_filter1d

        k0 = onset - lo_iso
        peaks = maximum_filter1d(np.abs(span[: k0 + 1]), size=w1, origin=-(w1 // 2))  # max over [i, i + w1)
        below = np.nonzero(peaks <= amp_th)[0]
        a = int(below[-1]) if below.size else 0
        above = np.nonzero(np.abs(span[a : k0 + 1]) > amp_th)[0]
        if above.size:
            onset = lo_iso + a + int(above[0])
        # How much of the attack is still below that threshold: time from t1 to 20 dB above it
        # (t10). A snap gets there at once and t1 is the start. A gradual rise started before
        # t1: by (t10 - t1) / 9 for a straight ramp (the best estimate, used for the reported
        # start and for "exact"), and by up to twice that for the slower, accelerating start
        # of a bowed or blown note (used for the cut, so it errs early).
        tail = np.abs(x[onset : min(n, onset + int(0.060 * sr))])
        big = np.nonzero(tail > 10.0 * amp_th)[0]
        rise10 = int(big[0]) if big.size else tail.size
        hidden = min(int(rise10 / 9), int(0.030 * sr))
        hidden_safe = min(int(rise10 / 4.5), int(0.030 * sr))
    elif sharp and modelled and lo <= onset < lo + res.size:
        # Under other sound: the same estimate on the prediction error (what the earlier sound
        # cannot explain), whose own quiet is the floor before the attack.
        j = onset - lo
        pre_r = np.abs(res[max(0, j - int(0.020 * sr)) : max(1, j - int(0.001 * sr))])
        if pre_r.size >= 8:
            r_th = 2.0 * float(np.percentile(pre_r, 99))
            tail = np.abs(res[j : j + int(0.030 * sr)])
            big = np.nonzero(tail > 10.0 * r_th)[0]
            rise10 = int(big[0]) if big.size else tail.size
            hidden = min(int(rise10 / 9), int(0.030 * sr))
            hidden_safe = min(int(rise10 / 4.5), int(0.030 * sr))
    pre_post_db = iso_db

    # Cut: before the estimated hidden part of the attack, plus 0.5 ms (a snap) or 2 ms and half
    # a period (a gradual start). A swell under other sound: 3 ms. Then onto a zero crossing.
    if hidden is not None:
        # A snap gets 0.5 ms. A gradual start's estimate is rougher: 2 ms, plus half a period,
        # since a low note's waveform only peaks above the threshold every half period.
        snap = hidden <= int(0.00025 * sr)
        margin = int(0.0005 * sr) if snap else int(0.002 * sr) + period // 2
        cut = max(0, onset - hidden_safe - margin)
        if hidden > int(0.00025 * sr):
            onset = max(0, onset - hidden)  # report the estimated start, not the crossing
    else:
        cut = max(0, onset - int((0.0005 if sharp else 0.003) * sr))
    a0, a1 = max(1, cut - int(0.0003 * sr)), min(n - 1, cut + 1)
    seg = x[a0 - 1 : a1 + 1]
    zc = np.nonzero(np.signbit(seg[:-1]) != np.signbit(seg[1:]))[0]
    if zc.size:
        cut = a0 - 1 + int(zc[-1]) + 1
    elif a1 > a0:
        cut = a0 + int(np.argmin(np.abs(x[a0:a1])))
    cut = min(cut, onset)
    steep = hidden is not None and hidden <= int(0.00025 * sr) and iso_db <= ISOLATED_DB
    # Exact only when the start is provable: a sharp attack, isolated (what sounded before is
    # 30 dB down), under 0.25 ms of it hidden below the quiet, no other note within 25 ms.
    exact = bool(sharp and steep and not crowded and iso_db <= ISOLATED_DB)
    return Onset(onset / sr, cut / sr, coarse, sharp, round(rise_ms, 2), round(snr, 1), modelled, exact, round(pre_post_db, 1))


def zoom(x: np.ndarray, sr: int, t: float, before_s: float = 0.006, after_s: float = 0.014, cols: int = 120) -> list[list[int]]:
    """Min/max columns (-100..100) around t, for drawing the cut on a zoomed waveform."""
    a = int(round((t - before_s) * sr))
    b = int(round((t + after_s) * sr))
    seg = np.zeros(b - a, np.float32)
    s0, s1 = max(0, a), min(x.size, b)
    if s1 > s0:
        seg[s0 - a : s1 - a] = x[s0:s1]
    peak = float(np.max(np.abs(seg))) or 1.0
    edges = np.linspace(0, seg.size, cols + 1).astype(int)
    out = []
    for i in range(cols):
        part = seg[edges[i] : max(edges[i + 1], edges[i] + 1)]
        out.append([int(round(100 * float(part.min()) / peak)), int(round(100 * float(part.max()) / peak))])
    return out
