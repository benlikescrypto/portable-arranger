"""Song -> playable ArrangerBox drum style.

Pipeline: Demucs drum stem -> beat_this beat grid -> bar-level drum patterns -> song
sections -> Pa elements (Intro, Variation 1-4, Fill 1-4, Break, Ending 1-3).

Each element is cut from the real drum stem at its onsets (a REX-style slice kit).
The `.abstyle` triggers slice k at the beat position where it was played, so the
arranger follows any tempo without time-stretch artifacts. A second style plays
the same groove transcribed onto the factory GM kit.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import numpy as np

from .common import PPQ, SR, Grid, Report, cosine_dist, decode, file_stem, mono, no_report, rms, safe_name
from .common import separate, track_beats, write_wav

HOP = 256
STEPS = 12  # pattern steps per beat (covers 16ths and triplets)
BANDS = {"low": (30.0, 150.0), "mid": (150.0, 2000.0), "high": (5000.0, 16000.0)}
MAX_SLICES = 120
FLUX_DELAY = 0.025  # seconds
GM_KICK, GM_SNARE, GM_HAT, GM_OPEN_HAT, GM_CRASH = 36, 38, 42, 46, 49


@dataclass
class Segment:
    start: int  # first bar
    end: int  # one past the last bar
    active: bool
    cluster: int = -1
    role: str = ""

    @property
    def bars(self) -> int:
        return self.end - self.start


@dataclass
class Element:
    name: str
    bar0: int
    bar1: int
    tail: float = 0.0  # seconds of ring-out after bar1 (endings)
    source: str = ""
    only_first_beat: bool = False  # break built from a groove bar


@dataclass
class Analysis:
    grid: Grid
    patterns: np.ndarray  # (nbars, dims), unit-normalized
    energy_db: np.ndarray
    onsets_per_bar: np.ndarray
    active: np.ndarray
    novelty: np.ndarray
    segments: list[Segment] = field(default_factory=list)
    fills: list[tuple[int, int]] = field(default_factory=list)  # (bar, next variation slot)


class DrumStem:
    """Spectral flux, onsets and per-bar patterns of a drum stem."""

    def __init__(self, y: np.ndarray, grid: Grid, sr: int = SR):
        import librosa

        self.y, self.grid, self.sr = y, grid, sr
        S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
        L = np.log1p(10.0 * S)
        self.flux: dict[str, np.ndarray] = {}
        self.energy: dict[str, np.ndarray] = {}
        for name, (lo, hi) in BANDS.items():
            m = (freqs >= lo) & (freqs < hi)
            band = L[m]
            d = np.diff(band, axis=1, prepend=band[:, :1])
            f = np.maximum(d, 0.0).sum(0)
            self.flux[name] = f / (np.percentile(f, 99.5) + 1e-9)
            self.energy[name] = (S[m] ** 2).sum(0) + 1e-12
        # Spectral flux of a centred 2048-point STFT peaks about half a window before the
        # transient; shift the frame times so a peak sits on the hit (calibrated on test songs).
        self.times = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP) + FLUX_DELAY
        # Onset function: the strongest band. A quiet hi-hat under a loud kit is clear in the
        # high band even when a full-band onset function hides it.
        oenv = np.max(np.stack([self.flux[b] for b in BANDS]), axis=0)
        self.oenv = oenv
        peaks = librosa.onset.onset_detect(
            onset_envelope=oenv, sr=sr, hop_length=HOP, units="frames", backtrack=False, delta=0.04, normalize=False
        )
        frame_rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0]
        ref = np.percentile(frame_rms, 98) + 1e-9
        n = len(frame_rms)
        keep = [int(p) for p in peaks if frame_rms[min(int(p) + 3, n - 1)] > ref * 10 ** (-38 / 20)]
        self.peaks = np.array(keep, dtype=int)
        backs = librosa.onset.onset_backtrack(self.peaks, oenv) if len(self.peaks) else self.peaks
        backs = np.maximum(backs, self.peaks - int(0.012 * sr / HOP))
        self.peak_t = self.times[np.minimum(self.peaks, len(self.times) - 1)]
        self.onset_t = self.times[np.minimum(backs, len(self.times) - 1)]
        self.strength = oenv[self.peaks] if len(self.peaks) else np.array([])

    def bar_pattern(self, b: int) -> np.ndarray:
        g = self.grid
        s = g.bar_beats[b]
        edges = g.time_at(s + np.arange(g.meter * STEPS + 1) / STEPS)
        fi = np.searchsorted(self.times, edges)
        vec = []
        for band in ("low", "mid", "high"):
            f = self.flux[band]
            for i in range(len(fi) - 1):
                a, z = fi[i], max(fi[i] + 1, fi[i + 1])
                vec.append(float(f[a:z].max()) if a < len(f) else 0.0)
        return np.array(vec)

    def onsets_between(self, t0: float, t1: float) -> np.ndarray:
        return np.where((self.onset_t >= t0) & (self.onset_t < t1))[0]


def mix_features(x_mono: np.ndarray, grid: Grid) -> np.ndarray:
    import librosa

    y = librosa.resample(x_mono, orig_sr=SR, target_sr=22050)
    hop = 512
    chroma = librosa.feature.chroma_stft(y=y, sr=22050, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=y, sr=22050, hop_length=hop, n_mfcc=13)
    t = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=22050, hop_length=hop)
    out = []
    for b in range(grid.nbars):
        t0, t1 = grid.bar_span(b)
        m = (t >= t0) & (t < t1)
        if not m.any():
            m = np.zeros_like(t, bool)
            m[min(len(t) - 1, np.searchsorted(t, t0))] = True
        out.append(np.concatenate([chroma[:, m].mean(1), mfcc[1:, m].mean(1)]))
    return np.array(out)


def novelty_curve(S: np.ndarray, k: int = 4) -> np.ndarray:
    n = len(S)
    nov = np.zeros(n)
    for b in range(1, n):
        lo, hi = max(0, b - k), min(n, b + k)
        a = S[lo:b, lo:b].mean()
        c = S[b:hi, b:hi].mean()
        x = S[lo:b, b:hi].mean()
        nov[b] = max(0.0, (a + c) / 2.0 - x)
    return nov


def analyze(stem: DrumStem, x_mono: np.ndarray) -> Analysis:
    g = stem.grid
    n = g.nbars
    if n < 4:
        raise ValueError("The song is too short to find bars.")
    P = np.array([stem.bar_pattern(b) for b in range(n)])
    norms = np.linalg.norm(P, axis=1, keepdims=True)
    Pn = P / np.maximum(norms, 1e-9)
    energy = np.array([20 * np.log10(rms(stem.y[int(g.bar_span(b)[0] * SR) : int(g.bar_span(b)[1] * SR)]) + 1e-9) for b in range(n)])
    counts = np.array([len(stem.onsets_between(g.bar_span(b)[0] - 0.03, g.bar_span(b)[1] - 0.03)) for b in range(n)])
    active = (energy > energy.max() - 30.0) & (counts >= 1)

    M = mix_features(x_mono, g)
    Mz = (M - M.mean(0)) / (M.std(0) + 1e-6)
    Mn = Mz / np.maximum(np.linalg.norm(Mz, axis=1, keepdims=True), 1e-9)
    # How busy a bar is separates grooves that share a shape (a waltz with 8th vs 16th hats).
    ld = np.log(counts + 1.0)
    Sd = np.exp(-2.0 * np.abs(ld[:, None] - ld[None, :]))
    S = 0.5 * (Pn @ Pn.T) + 0.25 * ((Mn @ Mn.T) + 1.0) / 2.0 + 0.25 * Sd
    S[~active, :] = 0.0
    S[:, ~active] = 0.0
    nov = novelty_curve(S, 4)

    first = int(np.argmax(active)) if active.any() else 0
    cand = []
    for b in range(1, n):
        if active[b] != active[b - 1]:
            cand.append((10.0, b))
            continue
        if nov[b] >= nov[b - 1] and (b + 1 >= n or nov[b] >= nov[b + 1]):
            phrase = 1.3 if (b - first) % 4 == 0 else 1.0
            cand.append((nov[b] * phrase, b))
    thr = max(0.04, 0.3 * (nov.max() if len(nov) else 0))
    chosen: list[int] = []
    for score, b in sorted(cand, reverse=True):
        if score < thr:
            continue
        if any(abs(b - c) < 2 for c in chosen):
            continue
        chosen.append(b)
    # A fill bar often scores as the boundary itself; move such boundaries onto the
    # 4-bar phrase line next to them so the fill stays the last bar of its section.
    snapped = []
    for b in sorted(chosen):
        if (b - first) % 4 != 0 and active[b] == active[b - 1]:
            for nb in (b + 1, b - 1):
                if 0 < nb < n and (nb - first) % 4 == 0 and nov[nb] >= 0.3 * nov[b] and nb not in chosen:
                    b = nb
                    break
        if b not in snapped:
            snapped.append(b)
    bounds = [0] + sorted(snapped) + [n]
    segs = [Segment(a, z, bool(active[a:z].mean() > 0.5)) for a, z in zip(bounds[:-1], bounds[1:]) if z > a]
    an = Analysis(g, Pn, energy, counts, active, nov, segs)
    cluster_segments(an)
    # Neighbouring sections with the same groove are one section.
    merged: list[Segment] = []
    for sg in an.segments:
        if merged and merged[-1].active == sg.active and merged[-1].cluster == sg.cluster:
            merged[-1].end = sg.end
        else:
            merged.append(sg)
    if len(merged) != len(an.segments):
        an.segments = merged
        for sg in merged:
            sg.cluster = -1
        cluster_segments(an)
    return an


def centroid(an: Analysis, seg: Segment) -> np.ndarray:
    bars = list(range(seg.start, seg.end))
    if len(bars) >= 3:
        bars = bars[:-1]  # the last bar may be a fill
    c = an.patterns[bars].mean(0)
    return c / max(np.linalg.norm(c), 1e-9)


def density(an: Analysis, seg: Segment) -> float:
    return float(np.median(an.onsets_per_bar[seg.start : seg.end])) + 1.0


def cluster_segments(an: Analysis, thr: float = 0.16) -> None:
    """Group sections that play the same groove: pattern shape plus how busy it is."""
    cents: list[np.ndarray] = []
    dens: list[float] = []
    members: list[list[int]] = []
    for i, seg in enumerate(an.segments):
        if not seg.active:
            continue
        c = centroid(an, seg)
        dn = density(an, seg)
        dists = [cosine_dist(c, k) + 0.5 * abs(np.log(dn / d)) for k, d in zip(cents, dens)]
        if dists and min(dists) < thr:
            j = int(np.argmin(dists))
            members[j].append(i)
            dens[j] = float(np.mean([density(an, an.segments[m]) for m in members[j]]))
            k = np.mean([centroid(an, an.segments[m]) for m in members[j]], axis=0)
            cents[j] = k / max(np.linalg.norm(k), 1e-9)
        else:
            j = len(cents)
            cents.append(c)
            dens.append(dn)
            members.append([i])
        seg.cluster = j


def bar_dev(an: Analysis, b: int, seg: Segment) -> float:
    return cosine_dist(an.patterns[b], centroid(an, seg))


def plan_elements(an: Analysis) -> dict[str, Element]:
    """Map song sections onto Pa style elements."""
    segs = an.segments
    act = [s for s in segs if s.active and s.bars >= 1]
    if not act:
        raise ValueError("No drums were found in this song.")
    n = an.grid.nbars
    cluster_of = lambda s: s.cluster  # noqa: E731
    count = {}
    for s in act:
        count[s.cluster] = count.get(s.cluster, 0) + s.bars

    intro_seg = act[0] if (len(act) > 2 and sum(1 for s in act if s.cluster == act[0].cluster) == 1 and act[0].bars <= 8) else None
    end_seg = act[-1] if (len(act) > 2 and sum(1 for s in act if s.cluster == act[-1].cluster) == 1 and act[-1].bars <= 8) else None
    body = [s for s in act if s is not intro_seg and s is not end_seg]
    if not body:
        body = act

    # Variation clusters: the most played grooves, ordered quiet -> busy.
    totals: dict[int, int] = {}
    for s in body:
        totals[s.cluster] = totals.get(s.cluster, 0) + s.bars
    top = sorted(totals, key=lambda c: -totals[c])[:4]

    def busy(c: int) -> float:
        bars = [b for s in body if s.cluster == c for b in range(s.start, s.end)]
        return float(np.mean(an.onsets_per_bar[bars]) + 0.1 * np.mean(an.energy_db[bars]))

    top.sort(key=busy)
    slot_of: dict[int, int] = {}
    if len(top) == 1:
        slot_of[top[0]] = 0
    else:
        for i, c in enumerate(top):
            slot_of[c] = int(round(i * 3 / (len(top) - 1)))

    # Fills: deviating busy bars at section ends and phrase ends.
    fill_flags = np.zeros(n, bool)
    fills: list[tuple[float, int, int]] = []  # (score, bar, slot of the variation that follows)
    for i, s in enumerate(act):
        if s.bars < 2:
            continue
        devs = np.array([bar_dev(an, b, s) for b in range(s.start, s.end)])
        typ = float(np.median(devs[:-1])) if s.bars > 2 else float(devs.min())
        dens = float(np.median(an.onsets_per_bar[s.start : s.end]))
        nxt = act[i + 1] if i + 1 < len(act) else None
        for k, b in enumerate(range(s.start, s.end)):
            last = b == s.end - 1
            phrase = (b - s.start) % 4 == 3
            if not (last or phrase):
                continue
            d = devs[k]
            if d > max(0.08, 2.0 * typ) and an.onsets_per_bar[b] >= 0.8 * dens:
                fill_flags[b] = True
                target = nxt.cluster if (last and nxt is not None) else s.cluster
                fills.append((d, b, slot_of.get(target, -1)))

    def loop_len(c: int) -> int:
        bars = [b for s in body if s.cluster == c for b in range(s.start, s.end) if not fill_flags[b]]
        lag = {}
        for L in (1, 2):
            ds = [cosine_dist(an.patterns[b], an.patterns[b + L]) for b in bars if b + L in bars]
            lag[L] = float(np.mean(ds)) if ds else 1.0
        if lag[1] < 0.06 or lag[2] < 0.08:
            return 2
        return 4

    def best_window(c: int, L: int, avoid: set[tuple[int, int]]) -> tuple[int, int] | None:
        best, where = 1e9, None
        for s in body:
            if s.cluster != c:
                continue
            cen = centroid(an, s)
            for b0 in range(s.start, s.end - L + 1):
                bars = range(b0, b0 + L)
                if any(fill_flags[b] for b in bars):
                    continue
                cost = float(np.mean([cosine_dist(an.patterns[b], cen) for b in bars]))
                if b0 == s.start and s.bars > L:
                    cost += 0.02  # first bar of a section usually has a crash
                if (b0, b0 + L) in avoid:
                    cost += 0.5
                if cost < best:
                    best, where = cost, (b0, b0 + L)
        if where is None:  # every bar is a fill: take the section start
            for s in body:
                if s.cluster == c:
                    return s.start, min(s.end, s.start + L)
        return where

    el: dict[str, Element] = {}
    used: set[tuple[int, int]] = set()
    for c in top:
        L = loop_len(c)
        w = best_window(c, L, used)
        if w:
            used.add(w)
            el[f"var{slot_of[c] + 1}"] = Element(f"var{slot_of[c] + 1}", w[0], w[1], source=f"cluster {c}")
    # Empty variation slots: another loop of the nearest quieter groove.
    for i in range(4):
        name = f"var{i + 1}"
        if name in el:
            continue
        near = min((slot_of[c] for c in top), key=lambda sl: (abs(sl - i), sl > i))
        c = next(cc for cc in top if slot_of[cc] == near)
        L = loop_len(c)
        w = best_window(c, L, used) or (el[f"var{near + 1}"].bar0, el[f"var{near + 1}"].bar1)
        used.add(w)
        el[name] = Element(name, w[0], w[1], source=f"cluster {c} (alt)")

    # Fills: Fill k leads into Variation k (Pa auto fill).
    fills.sort(reverse=True)
    for k in range(4):
        hit = next((f for f in fills if f[2] == k), None)
        if hit:
            el[f"fill{k + 1}"] = Element(f"fill{k + 1}", hit[1], hit[1] + 1, source="fill")
    spare = [f for f in fills]
    for k in range(4):
        name = f"fill{k + 1}"
        if name in el:
            continue
        if spare:
            f = spare[k % len(spare)]
            el[name] = Element(name, f[1], f[1] + 1, source="fill (shared)")
        else:
            # No fill in the song: the most deviating bar of the busiest variation.
            v = el[f"var{min(4, k + 1)}"]
            el[name] = Element(name, v.bar1 - 1, v.bar1, source="groove bar")

    # Break: a bar where the drums drop out between grooves.
    brk = None
    med = float(np.median(an.energy_db[an.active])) if an.active.any() else 0.0
    for b in range(2, n - 2):
        if an.active[b - 1] and an.active[b + 1] and an.energy_db[b] < med - 10:
            brk = b
            break
    if brk is not None:
        el["break"] = Element("break", brk, brk + 1, source="drop")
    else:
        v = el["var1"]
        el["break"] = Element("break", v.bar0, v.bar0 + 1, source="first beat", only_first_beat=True)

    # Intro.
    if intro_seg is not None:
        el["intro1"] = Element("intro1", intro_seg.start, intro_seg.end, source="intro")
        a = max(intro_seg.start, intro_seg.end - 2)
        el["intro2"] = Element("intro2", a, intro_seg.end, source="intro (short)")
    else:
        s = act[0]
        el["intro1"] = Element("intro1", s.start, min(s.end, s.start + 4), source="song start")
        el["intro2"] = Element("intro2", s.start, min(s.end, s.start + 2), source="song start (short)")

    # Endings, with the last hit ringing out.
    last_bar = max(s.end for s in act)
    if end_seg is not None:
        e0 = end_seg.start
    else:
        e0 = max(act[-1].start, last_bar - 4)
    el["end1"] = Element("end1", e0, last_bar, tail=3.0, source="ending")
    el["end2"] = Element("end2", max(e0, last_bar - 2), last_bar, tail=3.0, source="ending (short)")
    el["end3"] = Element("end3", last_bar - 1, last_bar, tail=3.0, source="last bar")

    # Roles for the section display.
    for s in segs:
        if not s.active:
            s.role = "No drums"
        elif s is intro_seg:
            s.role = "Intro"
        elif s is end_seg:
            s.role = "Ending"
        elif s.cluster in slot_of:
            s.role = f"Var {slot_of[s.cluster] + 1}"
        else:
            s.role = "Other"
    an.fills = [(b, sl) for _, b, sl in fills]
    return el


# ---------------------------------------------------------------- slicing


@dataclass
class Slice:
    tick: int
    start: int  # sample in the stem
    end: int
    peak_t: float


def slice_element(stem: DrumStem, e: Element) -> tuple[list[Slice], int]:
    g = stem.grid
    t0 = g.bar_span(e.bar0)[0]
    t1 = g.bar_span(e.bar1 - 1)[1]
    bp0 = g.beatpos(t0)
    length_ticks = int(round((g.beatpos(t1) - bp0) * PPQ))
    s0, s1 = int(t0 * SR), int(t1 * SR)
    early = int(0.025 * SR)
    idx = stem.onsets_between(t0 - 0.025, t1 - 0.025)
    starts = [int(stem.onset_t[i] * SR) for i in idx]
    peaks = [float(stem.peak_t[i]) for i in idx]
    strength = [float(stem.strength[i]) for i in idx]
    if e.only_first_beat:
        beat1 = g.time_at(bp0 + 1)
        keep = [k for k, s in enumerate(starts) if s < beat1 * SR - early]
        starts, peaks, strength = [starts[k] for k in keep], [peaks[k] for k in keep], [strength[k] for k in keep]
    # Slice 0 is the element start (the downbeat, or the ring-in from the bar before).
    if not starts or starts[0] > s0 + int(0.01 * SR):
        starts.insert(0, s0)
        peaks.insert(0, t0)
        strength.insert(0, 1e9)
    # Too many slices for one kit: drop the weakest, keep the first.
    while len(starts) > MAX_SLICES:
        k = 1 + int(np.argmin(strength[1:]))
        for arr in (starts, peaks, strength):
            arr.pop(k)
    if e.tail > 0:
        tail_end = min(len(stem.y), s1 + int(e.tail * SR))
        seg = np.abs(stem.y[s1:tail_end])
        if seg.size:
            win = 2048
            env = np.array([seg[i : i + win].max() for i in range(0, len(seg), win)])
            ref = max(np.abs(stem.y[s0:s1]).max(), 1e-6)
            quiet = np.where(env < ref * 10 ** (-48 / 20))[0]
            if len(quiet):
                tail_end = s1 + int(quiet[0] * win)
        end_all = tail_end
        if e.only_first_beat:
            end_all = int(g.time_at(bp0 + 1) * SR)
    elif e.only_first_beat:
        end_all = int(g.time_at(bp0 + 1) * SR)
    else:
        end_all = s1
        nxt = stem.onsets_between(t1 - 0.025, t1 + 0.025)
        if len(nxt):
            end_all = min(end_all, int(stem.onset_t[nxt[0]] * SR))
    out: list[Slice] = []
    for k, st in enumerate(starts):
        en = starts[k + 1] if k + 1 < len(starts) else end_all
        if en - st < int(0.004 * SR):
            continue
        # Grid position of the transient (the slice itself starts a few ms earlier).
        tick = 0 if k == 0 else int(round((g.beatpos(peaks[k]) - bp0) * PPQ))
        tick = max(0, min(length_ticks - 1, tick))
        if out and tick <= out[-1].tick:
            out[-1].end = en  # same grid position: merge into the previous slice
            continue
        out.append(Slice(tick, st, en, peaks[k]))
    if e.tail > 0 and out:
        ring_ticks = int(round((g.beatpos(out[-1].end / SR) - bp0) * PPQ))
        bar = g.meter * PPQ
        length_ticks = max(length_ticks, int(np.ceil(min(ring_ticks, length_ticks + bar) / bar)) * bar)
    return out, length_ticks


def write_kit(stem_stereo: np.ndarray, slices: list[Slice], wav_path: str, sfz_path: str, label: str) -> None:
    fade = int(0.006 * SR)
    parts, regions, pos = [], [], 0
    for k, s in enumerate(slices):
        seg = stem_stereo[:, s.start : s.end].copy()
        n = seg.shape[1]
        f = min(fade, n // 2)
        if f > 0:
            seg[:, n - f :] *= np.linspace(1.0, 0.0, f)[None, :]
        parts.append(seg)
        regions += ["<region>", f"sample={os.path.basename(wav_path)} key={k} offset={pos} end={pos + n - 1}"]
        pos += n
    write_wav(wav_path, np.concatenate(parts, axis=1))
    lines = [
        "// ArrangerBox AI drum slice kit",
        "<control>",
        "<global>",
        f"global_label={label}",
        "ab_kit=1",
        "ab_category=AI Kit",
        "<group>",
        "loop_mode=one_shot lovel=1 hivel=127",
    ] + regions
    with open(sfz_path, "w") as fh:
        fh.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------- GM transcription


def transcribe(stem: DrumStem) -> list[tuple[float, int, int]]:
    """Whole-song GM transcription: (time, note, velocity).

    Every onset's spectral change (40 mel bands, just after minus just before the hit)
    is factored with a small NMF into kick / snare / cymbal templates. The templates
    start from generic shapes and adapt to this song's kit, and the activations are
    additive, so a kick played with a hi-hat comes out as both. Cymbal decay then
    separates closed hat, open hat and crash.
    """
    import librosa

    if getattr(stem, "_gm", None) is not None:
        return stem._gm
    peaks = stem.peaks
    if len(peaks) == 0:
        stem._gm = []
        return []
    M = librosa.feature.melspectrogram(y=stem.y, sr=SR, n_fft=2048, hop_length=HOP, n_mels=40, fmin=30, fmax=16000, power=1.0)
    freqs = librosa.mel_frequencies(n_mels=40, fmin=30, fmax=16000)
    n = M.shape[1]
    V = []
    for p in peaks:
        a = M[:, min(n - 1, p) : min(n, p + 3)].mean(1)
        b = M[:, max(0, p - 4) : max(1, p - 1)].mean(1)
        V.append(np.maximum(a - b, 0.0))
    V = np.array(V) + 1e-9  # (onsets, bands)
    lf = np.log2(freqs)

    def bump(center: float, width: float) -> np.ndarray:
        return np.exp(-0.5 * ((lf - np.log2(center)) / width) ** 2)

    H = np.stack(
        [
            bump(60, 0.8),  # kick: sub thump
            bump(220, 0.6) + 0.5 * bump(1800, 0.9),  # snare: body plus wire noise
            bump(9000, 0.9) + 0.1 * bump(4000, 0.8),  # hi-hat / cymbal
        ]
    )
    H /= H.sum(1, keepdims=True)
    W = np.maximum(V @ np.linalg.pinv(H), 1e-6)
    prior = H.copy()
    for it in range(80):
        W *= (V @ H.T) / (W @ H @ H.T + 1e-12)
        if it % 4 == 3:  # let the templates fit the kit, but stay near their role
            Hn = H * (W.T @ V) / (W.T @ W @ H + 1e-12)
            Hn /= Hn.sum(1, keepdims=True)
            H = 0.4 * Hn + 0.6 * prior
    act = W * H.sum(1)[None, :]
    ref = np.percentile(act, 95, axis=0) + 1e-12
    rel = act / ref[None, :]
    thr = (0.4, 0.3, 0.15)
    energy = stem.energy["high"]
    hop_s = HOP / SR
    out: list[tuple[float, int, int]] = []
    for i, p in enumerate(peaks):
        t = float(stem.peak_t[i])
        r = rel[i]
        vel = lambda x: int(np.clip(40 + 80 * min(1.0, x), 30, 127))  # noqa: E731
        hits = []
        if r[1] >= thr[1]:
            hits.append((GM_SNARE, vel(r[1])))
        if r[2] >= thr[2]:
            nxt = int(peaks[i + 1]) if i + 1 < len(peaks) else p + int(0.1 / hop_s)
            f1 = min(len(energy) - 1, p + int(0.1 / hop_s), max(p + 1, nxt - 1))
            e0 = energy[p : p + 3].max()
            dt = max(hop_s, (f1 - p) * hop_s)
            decay_db_s = 10 * np.log10(energy[f1] / e0) / dt
            note = GM_HAT
            if decay_db_s > -70:
                pos = stem.grid.beatpos(t) - stem.grid.phase
                on_bar = abs(pos / stem.grid.meter - round(pos / stem.grid.meter)) * stem.grid.meter < 0.15
                note = GM_CRASH if (on_bar and r[2] > 1.0) else GM_OPEN_HAT
            hits.append((note, vel(r[2])))
        if not hits and r[0] < max(r[1], r[2]):
            # Below both thresholds: the stronger of snare / cymbal (kicks come below).
            hits.append((GM_SNARE, vel(r[1])) if r[1] > r[2] else (GM_HAT, vel(r[2])))
        out += [(t, note, v) for note, v in hits]
    # Kicks: peaks of the sub band, which a hi-hat cannot reach. Skip the body of a
    # snare (a mid-band hit with little sub energy) and very weak bleed.
    low = stem.flux["low"]
    kp = librosa.util.peak_pick(low, pre_max=3, post_max=3, pre_avg=12, post_avg=12, delta=0.02, wait=max(1, int(0.045 / hop_s)))
    if len(kp):
        kref = float(np.percentile(low[kp], 95)) + 1e-9
        snare_t = np.array([t for t, nt, _ in out if nt == GM_SNARE])
        mid = stem.flux["mid"]
        mref = float(np.percentile(mid[peaks], 95)) + 1e-9
        for p in kp:
            x = low[p] / kref
            if x < 0.35:
                continue
            t = float(stem.times[p])
            if len(snare_t) and np.min(np.abs(snare_t - t)) < 0.02 and x < 0.7 * (mid[p] / mref):
                continue
            out.append((t, GM_KICK, vel(x)))
    out.sort()
    stem._gm = out
    return out


def gm_events(stem: DrumStem, e: Element, length_ticks: int) -> list[tuple[int, int, int, int]]:
    g = stem.grid
    t0 = g.bar_span(e.bar0)[0]
    t1 = g.bar_span(e.bar1 - 1)[1]
    if e.only_first_beat:
        t1 = g.time_at(g.beatpos(t0) + 1)
    bp0 = g.beatpos(t0)
    evs = []
    for t, note, v in transcribe(stem):
        if t0 - 0.025 <= t < t1 - 0.025:
            tick = max(0, min(length_ticks - 1, int(round((g.beatpos(t) - bp0) * PPQ))))
            evs.append((tick, note, v, 24))
    return evs


# ---------------------------------------------------------------- output


ORDER = ["intro1", "intro2", "var1", "var2", "var3", "var4", "fill1", "fill2", "fill3", "fill4", "break", "end1", "end2", "end3"]


def extract_drum_style(path: str, name: str, outdir: str, report: Report = no_report) -> dict:
    os.makedirs(outdir, exist_ok=True)
    name = safe_name(name)
    stem_name = file_stem(name)
    report("decode", 0.02, "Reading the song")
    x = decode(path)
    duration = x.shape[1] / SR
    report("separate", 0.08, "Separating the drums (Demucs)")
    stems = separate(x, "htdemucs")
    drums = stems["drums"]
    peak = float(np.abs(drums).max())
    if peak < 1e-4:
        raise ValueError("No drums were found in this song.")
    drums = drums * (0.89 / peak)
    report("beats", 0.45, "Finding the tempo and bars")
    beats, downs = track_beats(mono(x))
    grid = Grid.build(beats, downs, duration)
    report("sections", 0.55, "Finding intro, variations, fills and ending")
    stem = DrumStem(mono(drums), grid)
    an = analyze(stem, mono(x))
    el = plan_elements(an)
    report("slice", 0.7, "Cutting the drum loops")

    files: list[str] = []
    kit_of: dict[tuple, str] = {}
    sections_audio = []
    gm_sections = []
    for nm in ORDER:
        e = el[nm]
        slices, length = slice_element(stem, e)
        if not slices:
            continue
        key = (e.bar0, e.bar1, e.tail, e.only_first_beat)
        if key not in kit_of:
            base = f"{stem_name}_{nm}"
            write_kit(drums, slices, os.path.join(outdir, base + ".wav"), os.path.join(outdir, base + ".sfz"), f"{name} {nm}")
            kit_of[key] = base + ".sfz"
            files += [base + ".wav", base + ".sfz"]
        evs = [(s.tick, k, 127, max(1, (slices[k + 1].tick if k + 1 < len(slices) else length) - s.tick)) for k, s in enumerate(slices)]
        sections_audio.append((nm, length, kit_of[key], evs))
        gm_sections.append((nm, length, gm_events(stem, e, length)))

    tempo = round(grid.bpm, 1)

    def write_style(fname: str, title: str, secs, with_kits: bool) -> None:
        lines = ["ABSTYLE1", f"name={title}", "category=AI Drums", f"tempo={tempo}", f"meter={grid.meter}"]
        for sec in secs:
            if with_kits:
                nm, length, kit, evs = sec
            else:
                nm, length, evs = sec
            lines += [f"section={nm}", f"length={length}"]
            if with_kits:
                lines.append(f"kit={kit}")
            for tick, note, vel, dur in evs:
                lines.append(f"{tick},0,{note},{vel},{dur},abs")
        with open(os.path.join(outdir, fname), "w") as fh:
            fh.write("\n".join(lines) + "\n")
        files.append(fname)

    report("build", 0.85, "Writing the styles")
    write_style(f"{stem_name}.abstyle", name, sections_audio, True)
    write_style(f"{stem_name}_gm.abstyle", f"{name} GM"[:39], gm_sections, False)

    bar_times = grid.bar_times.tolist()

    def bar_t(b: int) -> float:
        return float(bar_times[b]) if b < len(bar_times) else float(grid.bar_span(len(bar_times) - 1)[1])

    manifest = {
        "kind": "drums",
        "name": name,
        "bpm": tempo,
        "meter": grid.meter,
        "duration": round(duration, 2),
        "bars": len(bar_times),
        "barTimes": [round(t, 3) for t in bar_times],
        "sections": [
            {"role": s.role, "bar0": s.start, "bar1": s.end, "start": round(bar_t(s.start), 2), "end": round(bar_t(s.end), 2), "cluster": s.cluster}
            for s in an.segments
        ],
        "fills": [{"bar": b, "into": sl + 1 if sl >= 0 else None} for b, sl in an.fills],
        "elements": {nm: {"bar0": el[nm].bar0, "bar1": el[nm].bar1, "source": el[nm].source} for nm in ORDER if nm in el},
        "styles": [
            {"name": name, "file": f"{stem_name}.abstyle", "type": "audio"},
            {"name": f"{name} GM"[:39], "file": f"{stem_name}_gm.abstyle", "type": "gm"},
        ],
        "sounds": [],
        "files": sorted(set(files)),
    }
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    report("done", 1.0, f"{tempo:g} BPM · {grid.meter}/4 · {len(an.segments)} sections")
    return manifest
