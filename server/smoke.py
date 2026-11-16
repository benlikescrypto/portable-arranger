"""Image smoke test: `modal run smoke.py` builds the GPU image and checks every model loads."""

import modal

from images import gpu_image

app = modal.App("arrangerbox-ai-smoke")


@app.function(image=gpu_image, gpu="L4", timeout=900)
def smoke():
    import numpy as np
    import torch

    out = {"cuda": torch.cuda.is_available()}
    sr = 44100
    t = np.arange(sr * 8) / sr
    clicks = (np.sin(2 * np.pi * 1000 * t) * (np.mod(t, 0.5) < 0.02)).astype(np.float32)
    from beat_this.inference import Audio2Beats

    beats, downs = Audio2Beats(checkpoint_path="/models/beat_this_final0.ckpt", device="cuda", dbn=False)(clicks, sr)
    out["beats"] = len(beats)
    from demucs.pretrained import get_model

    m = get_model("htdemucs_6s")
    out["sources"] = list(m.sources)
    import basic_pitch
    from basic_pitch import ICASSP_2022_MODEL_PATH

    out["bp_model"] = str(ICASSP_2022_MODEL_PATH)
    import soundfile as sf

    sf.write("/tmp/c.wav", np.sin(2 * np.pi * 440 * t).astype(np.float32) * 0.5, sr)
    from basic_pitch.inference import predict

    _, _, notes = predict("/tmp/c.wav", ICASSP_2022_MODEL_PATH)
    out["bp_notes"] = [(round(n[0], 2), round(n[1], 2), n[2]) for n in notes[:3]]
    from panns_inference import AudioTagging, labels

    at = AudioTagging(checkpoint_path=None, device="cuda")
    clip, _ = at.inference(np.zeros((1, 32000 * 2), np.float32))
    out["panns"] = clip.shape, len(labels)
    import subprocess

    out["fluidsynth"] = subprocess.run(["fluidsynth", "--version"], capture_output=True, text=True).stdout[:40]
    print(out)
    return out


@app.local_entrypoint()
def main():
    print(smoke.remote())
