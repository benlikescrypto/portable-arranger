import sys, numpy as np
sys.path.insert(0, sys.argv[1])
from swift_f0 import SwiftF0, segment_notes
out = sys.argv[2]
sr = 16000
rng = np.random.default_rng(7)
# A sung-like line: harmonic tones, vibrato, gaps, a repeated note, a slide, quiet breath noise.
seq = []
t = 0.0
melody = [60, 62, 64, 64, 65, 67, None, 69, 67, 65, 64, None, 62, 60, 55, 57, 59, 60, None]
parts = []
for rep in range(5):
    for k, n in enumerate(melody):
        d = 0.35 + 0.25 * ((k * 7 + rep) % 3)
        L = int(d * sr)
        tt = np.arange(L) / sr
        if n is None:
            parts.append(0.002 * rng.standard_normal(L).astype(np.float32))
            continue
        f = 440 * 2 ** ((n + 12 * (rep % 2) - 12 - 69) / 12) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * tt))
        ph = 2 * np.pi * np.cumsum(f) / sr
        x = sum((0.6 / h) * np.sin(h * ph) for h in range(1, 7))
        env = np.minimum(1, tt / 0.02) * np.minimum(1, (d - tt) / 0.05)
        parts.append((0.4 * env * x).astype(np.float32))
audio = np.concatenate(parts).astype(np.float32)
audio = np.concatenate([np.zeros(sr // 2, np.float32), audio, np.zeros(sr // 3, np.float32)])
print("seconds", len(audio) / sr)
det = SwiftF0()
r = det.detect(audio, sr)
notes = segment_notes(r)
audio.tofile(out + "/audio.f32")
r.pitch_hz.astype(np.float32).tofile(out + "/pitch.f32")
r.confidence.astype(np.float32).tofile(out + "/conf.f32")
r.loudness_db.astype(np.float32).tofile(out + "/loud.f32")
with open(out + "/notes.txt", "w") as fh:
    for nt in notes:
        m = 69 + 12 * np.log2(nt.pitch_hz / 440)
        fh.write(f"{nt.start:.6f} {nt.end:.6f} {m:.4f}\n")
print("frames", len(r.pitch_hz), "notes", len(notes))
# Resampler reference: a 44.1 kHz stereo int16 sweep-free test tone for the C++ resampler.
sr2 = 44100
tt = np.arange(int(3 * sr2)) / sr2
tone = (0.5 * np.sin(2 * np.pi * 440 * tt) * 32767).astype(np.int16)
np.stack([tone, tone], 1).tofile(out + "/tone44k.s16")
