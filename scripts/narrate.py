"""Generate one WAV per scene using locally installed Kokoro weights."""

import json
import sys
from pathlib import Path

import soundfile
from kokoro_onnx import Kokoro


def main():
    storyboard, assets = map(Path, sys.argv[1:])
    model_dir = Path(__file__).resolve().parent.parent / ".kokoro"
    model = Kokoro(
        str(model_dir / "kokoro-v1.0.onnx"), str(model_dir / "voices-v1.0.bin")
    )
    scenes = json.loads(storyboard.read_text(encoding="utf-8"))["scenes"]
    for scene in scenes:
        index = scene["index"]
        voice = scene["kokoroVoice"]
        language = "en-gb" if voice.startswith("b") else "en-us"
        samples, sample_rate = model.create(
            scene["narration"], voice=voice, speed=1.03, lang=language
        )
        soundfile.write(assets / f"speech-{index}.wav", samples, sample_rate)


if __name__ == "__main__":
    main()
