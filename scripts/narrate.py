"""Generate one WAV per scene using locally installed Kokoro weights."""

import json
import sys
from pathlib import Path

import soundfile
from kokoro_onnx import Kokoro


def main():
    storyboard, assets, weights, voices = map(Path, sys.argv[1:])
    model = Kokoro(str(weights), str(voices))
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
