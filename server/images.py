"""Container images for the ArrangerBox AI server (Modal)."""

from pathlib import Path

import modal

HERE = Path(__file__).parent
REPO = HERE.parent
SF2 = REPO / "modules" / "audio" / "factory" / "GeneralUser-GS.sf2"


BEAT_CKPT = "/models/beat_this_final0.ckpt"


def _beat_this_checkpoint():
    """beat_this final0 as a local checkpoint. The JKU host rate-limits, so fall back to the
    safetensors copy on Hugging Face (weights only, no pickled code)."""
    import json
    import os

    import torch

    os.makedirs("/models", exist_ok=True)
    try:
        ck = torch.hub.load_state_dict_from_url(
            "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt", map_location="cpu"
        )
        torch.save({"hyper_parameters": ck["hyper_parameters"], "state_dict": ck["state_dict"]}, BEAT_CKPT)
        return
    except Exception as exc:
        print("JKU checkpoint download failed, using the Hugging Face copy:", exc)
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file

    repo = "safe-models/beat-this-final0"
    rev = "39ec64821baf38aa16fafa500a91379c16db0062"
    cfg = json.load(open(hf_hub_download(repo, "config.json", revision=rev)))
    sd = load_file(hf_hub_download(repo, "model.safetensors", revision=rev))
    import inspect

    from beat_this.model.beat_tracker import BeatThis

    hp = {k: v for k, v in cfg.items() if k in set(inspect.signature(BeatThis).parameters)}
    full = BeatThis(**hp).state_dict()  # rotary-embedding buffers are computed, not stored
    unknown = set(sd) - set(full)
    assert not unknown, unknown
    full.update(sd)
    torch.save({"hyper_parameters": cfg, "state_dict": {"model." + k: v for k, v in full.items()}}, BEAT_CKPT)


def _download_models():
    """Bake every model checkpoint into the image so cold starts do not download."""
    import torch

    from demucs.pretrained import get_model

    for name in ("htdemucs", "htdemucs_ft", "htdemucs_6s"):
        get_model(name)
    _beat_this_checkpoint()
    from beat_this.inference import Audio2Beats

    Audio2Beats(checkpoint_path=BEAT_CKPT, device="cpu", dbn=False)
    from panns_inference import AudioTagging

    AudioTagging(checkpoint_path=None, device="cpu")
    torch.hub  # noqa: B018 (keep import used)


gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1", "wget", "git", "fluidsynth")
    .pip_install(
        "torch==2.5.1",
        "torchaudio==2.5.1",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "numpy<2",
        "scipy<1.15",
        "librosa==0.10.2.post1",
        "soundfile",
        "soxr",
        "einops",
        "rotary-embedding-torch",
        "tqdm",
        "demucs==4.0.1",
        "onnxruntime==1.20.1",
        "pretty_midi",
        "mir_eval",
        "resampy<0.4.3",
        "scikit-learn",
        "mido",
        "panns-inference==0.1.1",
        "torchlibrosa==0.1.0",
        "pytest",
        "huggingface_hub",
        "safetensors",
        "fastapi[standard]",
        "httpx",
        "pyjwt[crypto]",
    )
    # basic-pitch pulls TensorFlow on Linux; the ONNX model needs only onnxruntime.
    .pip_install("basic-pitch==0.4.0", extra_options="--no-deps")
    .pip_install(
        "beat_this @ https://github.com/CPJKU/beat_this/archive/refs/heads/main.zip",
        extra_options="--no-deps",
    )
    .run_function(_download_models)
    .env({"PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"})
)

web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]", "python-multipart", "httpx", "pyjwt[crypto]")
