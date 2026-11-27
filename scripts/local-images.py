"""Illustrate a generated storyboard using only installed SD-Turbo weights."""

import json
import sys
from pathlib import Path

import torch
from diffusers import AutoPipelineForText2Image

directory = Path(sys.argv[1])
weights = Path(__file__).resolve().parent.parent / ".local-models/sd-turbo"
device = "mps" if torch.backends.mps.is_available() else "cpu"
pipeline = AutoPipelineForText2Image.from_pretrained(
    weights, local_files_only=True, variant="fp16",
    torch_dtype=torch.float16 if device == "mps" else torch.float32,
).to(device)
board = json.loads((directory / "local-storyboard.json").read_text())
for scene in board["scenes"]:
    image = pipeline(
        prompt=board["settings"]["style"] + ", portrait composition, " + scene["imagePrompt"],
        height=640, width=384, num_inference_steps=2, guidance_scale=0.0,
    ).images[0]
    image.save(directory / scene["image"])
