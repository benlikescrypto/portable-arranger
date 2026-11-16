"""Shared audio I/O, source separation and beat grid for the ArrangerBox AI jobs."""

from __future__ import annotations

import subprocess
import unicodedata
from dataclasses import dataclass
from typing import Callable

import numpy as np

SR = 44100
PPQ = 96  # ArrangerBox style resolution (kPpq in Engine.h)

Report = Callable[[str, float, str], None]


def no_report(stage: str, frac: float, msg: str = "") -> None:
    print(f"[{stage}] {frac:.2f} {msg}")


def decode(path: str, sr: int = SR, max_seconds: float = 720.0) -> np.ndarray:
    """Decode any ffmpeg-readable file to float32 stereo (2, n)."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-t", str(max_seconds)]
    cmd += ["-f", "f32le", "-ac", "2", "-ar", str(sr), "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise ValueError("Could not read that audio file: " + proc.stderr.decode(errors="replace")[-300:])
    x = np.frombuffer(proc.stdout, np.float32).reshape(-1, 2).T.copy()
    if x.shape[1] < sr * 4:
        raise ValueError("The song is shorter than 4 seconds.")
    return x


def mono(x: np.ndarray) -> np.ndarray:
    return x.mean(0) if x.ndim == 2 else x


def write_wav(path: str, x: np.ndarray, sr: int = SR) -> None:
    import soundfile as sf

    data = x.T if x.ndim == 2 else x
    sf.write(path, np.clip(data, -1.0, 1.0), sr, subtype="PCM_16")


def db(x: float | np.ndarray) -> float | np.ndarray:
    return 20.0 * np.log10(np.maximum(np.abs(x), 1e-9))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)) + 1e-20)) if x.size else 0.0


def device() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


_MODELS: dict = {}


def separate(x: np.ndarray, model_name: str = "htdemucs") -> dict[str, np.ndarray]:
    """Demucs source separation. Returns stem name -> (2, n) float32 at SR."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if model_name not in _MODELS:
        m = get_model(model_name)
        m.eval()
        _MODELS[model_name] = m.to(device())
    model = _MODELS[model_name]
    assert model.samplerate == SR
    wav = torch.from_numpy(x)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        out = apply_model(model, wav[None].to(device()), shifts=1, split=True, overlap=0.25, progress=False)[0]
    out = out * std + mean
    return {name: out[i].cpu().numpy().astype(np.float32) for i, name in enumerate(model.sources)}


def track_beats(x_mono: np.ndarray, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """Beat and downbeat times (seconds) with beat_this; librosa as a fallback."""
    try:
        from beat_this.inference import Audio2Beats

        if "beat_this" not in _MODELS:
            _MODELS["beat_this"] = Audio2Beats(checkpoint_path="/models/beat_this_final0.ckpt", device=device(), dbn=False)
        beats, downs = _MODELS["beat_this"](x_mono.astype(np.float32), sr)
        beats, downs = np.asarray(beats, float), np.asarray(downs, float)
        if len(beats) >= 8:
            return beats, downs
    except Exception as exc:  # pragma: no cover - fallback path
        print("beat_this failed, using librosa:", exc)
    import librosa

    _, frames = librosa.beat.beat_track(y=x_mono, sr=sr, hop_length=512)
    beats = librosa.frames_to_time(frames, sr=sr, hop_length=512)
    return beats, beats[::4]


def smooth_beats(beats: np.ndarray, half: int = 6) -> np.ndarray:
    """Local linear fit per beat. beat_this reports beats on a 20 ms frame grid; a
    windowed fit removes that jitter but still follows tempo changes."""
    n = len(beats)
    if n < 2 * half + 2:
        return beats
    idx = np.arange(n, dtype=float)
    out = beats.copy()
    for i in range(n):
        a, z = max(0, i - half), min(n, i + half + 1)
        k, c = np.polyfit(idx[a:z], beats[a:z], 1)
        pred = k * i + c
        # Keep a real timing change: only smooth small deviations.
        if abs(pred - beats[i]) < 0.03:
            out[i] = pred
    return out


@dataclass
class Grid:
    """A regular beat grid: beat times, meter and which beats start bars."""

    beats: np.ndarray
    meter: int
    phase: int
    duration: float

    @staticmethod
    def build(beats: np.ndarray, downs: np.ndarray, duration: float) -> "Grid":
        beats = np.unique(np.asarray(beats, float))
        if len(beats) < 8:
            raise ValueError("Could not find a steady beat in this song.")
        ibi = float(np.median(np.diff(beats)))
        # Close gaps where the tracker skipped beats.
        fixed = [float(beats[0])]
        for b in beats[1:]:
            gap = b - fixed[-1]
            if gap < ibi * 0.5:
                continue  # a spurious extra beat
            n = int(round(gap / ibi))
            if n >= 2:
                fixed.extend(np.linspace(fixed[-1], b, n + 1)[1:-1].tolist())
            fixed.append(float(b))
        beats = smooth_beats(np.array(fixed))
        ibi = float(np.median(np.diff(beats)))
        # Extend to cover the whole file at the local spacing.
        head = []
        t = beats[0] - ibi
        while t > -ibi * 0.5:
            head.append(t)
            t -= ibi
        tail = []
        t = beats[-1] + ibi
        while t < duration + ibi:
            tail.append(t)
            t += ibi
        beats = np.concatenate([np.array(head[::-1]), beats, np.array(tail)])
        # Meter: most common number of beats between downbeats (3 or 4).
        idx = np.array([int(np.argmin(np.abs(beats - d))) for d in downs]) if len(downs) else np.array([], int)
        meter = 4
        if len(idx) >= 3:
            gaps = np.diff(idx)
            gaps = gaps[(gaps >= 2) & (gaps <= 8)]
            if len(gaps):
                vals, counts = np.unique(gaps, return_counts=True)
                m = int(vals[np.argmax(counts)])
                meter = 3 if m in (3, 6) else 4
        phase = 0
        if len(idx):
            counts = np.bincount(idx % meter, minlength=meter)
            phase = int(np.argmax(counts))
        return Grid(beats=beats, meter=meter, phase=phase, duration=duration)

    @property
    def bpm(self) -> float:
        # Least-squares slope over the tracked part (the extrapolated ends add nothing).
        b = self.beats
        slope = np.polyfit(np.arange(len(b), dtype=float), b, 1)[0]
        return 60.0 / float(slope)

    def beatpos(self, t: float | np.ndarray) -> float | np.ndarray:
        """Fractional beat index at time t (linear between beats, extrapolated outside)."""
        b = self.beats
        idx = np.arange(len(b), dtype=float)
        ibi0, ibi1 = b[1] - b[0], b[-1] - b[-2]
        t = np.asarray(t, float)
        out = np.interp(t, b, idx)
        out = np.where(t < b[0], (t - b[0]) / ibi0, out)
        out = np.where(t > b[-1], len(b) - 1 + (t - b[-1]) / ibi1, out)
        return out if out.ndim else float(out)

    def time_at(self, pos: float | np.ndarray) -> float | np.ndarray:
        b = self.beats
        idx = np.arange(len(b), dtype=float)
        pos = np.asarray(pos, float)
        out = np.interp(pos, idx, b)
        out = np.where(pos < 0, b[0] + pos * (b[1] - b[0]), out)
        out = np.where(pos > len(b) - 1, b[-1] + (pos - len(b) + 1) * (b[-1] - b[-2]), out)
        return out if out.ndim else float(out)

    @property
    def bar_beats(self) -> np.ndarray:
        """Beat index where each complete bar starts."""
        first = self.phase
        starts = np.arange(first, len(self.beats) - self.meter, self.meter)
        return starts

    @property
    def bar_times(self) -> np.ndarray:
        return self.beats[self.bar_beats]

    @property
    def nbars(self) -> int:
        return len(self.bar_beats)

    def bar_span(self, b: int) -> tuple[float, float]:
        s = self.bar_beats[b]
        return float(self.beats[s]), float(self.beats[s + self.meter])


def cosine_dist(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-9 or nb < 1e-9:
        return 1.0 if (na > 1e-9) != (nb > 1e-9) else 0.0
    return float(1.0 - np.dot(a, b) / (na * nb))


def safe_name(name: str, fallback: str = "Song") -> str:
    keep = "".join(c if (c.isalnum() or c in " -_&'()") else " " for c in name).strip()
    keep = " ".join(keep.split())
    return (keep or fallback)[:28]


def file_stem(name: str) -> str:
    # File names stay ASCII (the API serves only [A-Za-z0-9_.-]): "Señor Ünïcode" -> "senor_unicode".
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = "".join(c.lower() if c.isalnum() else "_" for c in name)
    while "__" in s:
        s = s.replace("__", "_")
    return s.strip("_")[:40] or "song"
