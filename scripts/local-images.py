"""Illustrate a generated storyboard using a local Diffusers pipeline."""

import json
import sys
from pathlib import Path

import torch
from diffusers import AutoPipelineForText2Image

directory = Path(sys.argv[1])
weights = Path(sys.argv[2])
device = "mps" if torch.backends.mps.is_available() else "cpu"
variant = "fp16" if any((weights / "unet").glob("*.fp16*.safetensors")) else None
pipeline = AutoPipelineForText2Image.from_pretrained(
    weights, local_files_only=True, variant=variant, use_safetensors=True,
    torch_dtype=torch.float16 if device == "mps" else torch.float32,
).to(device)
board = json.loads((directory / "local-storyboard.json").read_text())
presets = {"turbo": (384, 640, 2, 0.0), "standard": (512, 768, 25, 7.5), "sdxl": (768, 1024, 25, 5.0)}
width, height, steps, guidance = presets[board["settings"]["imagePreset"]]
for scene in board["scenes"]:
    image = pipeline(
        prompt=board["settings"]["style"] + ", portrait composition, " + scene["imagePrompt"],
        height=height, width=width, num_inference_steps=steps, guidance_scale=guidance,
    ).images[0]
    image.save(directory / scene["image"])
