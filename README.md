# AI Short Generator

Turn a ChatGPT-written script and scene illustrations into an educational Short. Kokoro narrates on your Mac, and Remotion adds motion and captions and exports the video locally. The CLI uses no paid APIs.

## Setup

Use Node.js 22 or newer, pnpm 12, and FFmpeg with `ffprobe` on your PATH.

```sh
brew install ffmpeg
pnpm install --frozen-lockfile
```

The first render may download Remotion's headless browser.

## Try a local demo

```sh
pnpm generate --demo
```

The demo uses four bundled black hole illustrations, bundled neural narration, estimated phrase-level caption timing, and a locally synthesized ambient bed. The narration was generated locally with [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) using its `af_heart` voice. Running the demo requires neither the model files nor an API key.

## Make a Short with ChatGPT and local narration

1. Run `pnpm setup:voice` once. It uses Python 3.12 and downloads about 340 MB of Kokoro model and voice files into the ignored `.kokoro/` directory.
2. Ask ChatGPT for a script split into scenes and a portrait illustration for each scene. For a roughly 45-second Short, ask for about 100 spoken words across six to eight scenes.
3. Save the images and a `storyboard.json` together. Image paths are relative to the storyboard file. Each scene supplies its exact spoken text and one local image.

```json
{
  "title": "Why do black holes look bright?",
  "scenes": [
    {
      "narration": "If light can't escape a black hole, what is that glowing ring?",
      "image": "scene-1.png"
    },
    {
      "narration": "It's hot gas orbiting outside the event horizon.",
      "image": "scene-2.png"
    }
  ]
}
```

```sh
pnpm generate --storyboard path/to/storyboard.json
```

Append `--music /path/to/track.mp3` to mix a local track under the narration. The final export is a 1080 × 1920, 30 fps H.264 MP4 with AAC audio.

Each run prints a unique directory under `output/` containing the source storyboard, `project.json`, the converted images and narration in `assets/`, and `short.mp4`. Caption timing is estimated from each scene's narration length. You can edit captions in `project.json` and rerender without regenerating narration.

```sh
pnpm generate --render output/your-project-directory
pnpm check
```

### Demo illustration prompts

The four bundled JPEGs in `demo/` were created with the built-in ImageGen tool. Each prompt used vertical, full-bleed cinematic science-documentary framing with natural film grain and a quiet lower quarter for captions. The palette used deep navy, black, and white-hot amber, with no lettering or logos.

1. A tilted close-up of a stellar black hole with a bright asymmetric amber disk bent over and under the dark shadow.
2. A side-on close-up of turbulent incandescent gas, with intricate copper and ivory filaments in orbital flow.
3. A distant black hole warping a cool-blue background starfield into slender, duplicated arcs around the shadow.
4. A deep-space wide shot with a thin, asymmetric golden arc and a vast field of cold stars.
