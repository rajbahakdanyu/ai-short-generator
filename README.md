# AI Short Generator

Make an illustrated educational Short from your own storyboard or from a topic using a paid API. The storyboard workflow uses local Kokoro narration. Remotion adds motion and captions and exports the video locally in both workflows.

## Setup

Use Node.js 26.13.1 or newer, pnpm 12, and FFmpeg with `ffprobe` on your PATH.

```sh
brew install ffmpeg
pnpm install --frozen-lockfile
```

The first render may download Remotion's headless browser.

## Code checks

Run `pnpm check` for Biome linting, import organisation, formatting checks, and TypeScript type checking. Use `pnpm lint` to run only the linter or `pnpm format` to format files in place. Run `pnpm exec biome check --write .` to also organise imports and apply safe fixes.

Biome uses its recommended rules and enforces React hook checks, type-only imports, unused code checks, and explicit `node:` imports. Generated output, render caches, and local model files are excluded.

## Open Short Studio

```sh
pnpm studio
```

Open [Short Studio](http://127.0.0.1:5173/). The bundled black-hole project opens on first launch. Use **Project** to start a blank draft, paste a script with one scene per paragraph, or reload the sample.

- Add, rename, reorder, or delete scenes. Drop a still image or MP4 into each scene's **Visual** field.
- Use **Generate voice** to hear the scene locally and edit caption text and timing in **Captions**. Install Kokoro with `pnpm setup:voice` if it is missing. The bundled sample can preview and export without installing Kokoro.
- Use **Export MP4** to render and download the video. The saved project and MP4 live under `output/studio-*/`. An optional soundtrack is mixed during export.

The editor saves one draft plus imported media in the browser on this device. The server listens on loopback. The Studio uses the local generation pipeline. Paid generation remains available through the CLI below.

For a production frontend build, run `pnpm build` followed by `pnpm studio:preview`.

## Try a local demo

```sh
pnpm generate --demo
```

The demo mixes three bundled black hole illustrations and a moving accretion-disk visualization with bundled neural narration, estimated phrase-level caption timing, and a locally synthesized ambient bed. The narration was generated locally with [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) using its `af_heart` voice. Running the demo requires neither the model files nor an API key.

## Make a Short with ChatGPT and local narration

1. Run `pnpm setup:voice` once. It uses Python 3.12 and downloads about 340 MB of Kokoro model and voice files into the ignored `.kokoro/` directory.
2. Ask ChatGPT for a script split into scenes and a portrait illustration or clip for each scene. For a roughly 45-second Short, ask for about 100 spoken words across six to eight scenes.
3. Save the images or MP4 clips and a `storyboard.json` together. Visual paths are relative to the storyboard file. Each scene supplies its exact spoken text and either an `image` or a `video`.

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
      "video": "scene-2.mp4"
    }
  ]
}
```

```sh
pnpm generate --storyboard path/to/storyboard.json
```

Narration sets the scene length. Clips are cropped to fill the vertical frame and play muted under the narration. A longer clip is trimmed to fit, and a shorter clip loops. Stills retain their pan and zoom.

Append `--music /path/to/track.mp3` to mix a local track under the narration. The final export is a 1080 × 1920, 30 fps H.264 MP4 with AAC audio.

Each run prints a unique directory under `output/` containing the source storyboard, `project.json`, the prepared visuals and narration in `assets/`, and `short.mp4`. Caption timing is estimated from each scene's narration length. You can edit captions in `project.json` and rerender without regenerating narration.

```sh
pnpm generate --render output/your-project-directory
pnpm check
```

## Generate from a topic with a paid API

Copy `.env.example` to `.env` and set `OPENAI_API_KEY`. For a third-party OpenAI-compatible provider, set `OPENAI_BASE_URL` to its API base URL (often ending in `/v1`), use that provider’s key, and set `SCRIPT_MODEL`, `IMAGE_MODEL`, `VOICE_MODEL`, and `VOICE` to values it supports. Set `IMAGE_SIZE` if your provider requires a specific size.

```sh
pnpm generate --paid-topic "Why does the Moon look bigger near the horizon?"
```

This explicitly opts into billable requests. The full paid workflow needs OpenAI-compatible Chat Completions, image generation (returning a URL or base64 image), and speech generation. Captions are estimated locally and Remotion renders the MP4 on your Mac. Add `--music path/to/track.mp3` to mix a local track into the export.

If your provider only supports Chat Completions, use `--plan-only`. Only script generation uses the API in that mode:

```sh
pnpm generate --paid-topic "Why does the Moon look bigger near the horizon?" --plan-only
```

The saved `storyboard.json` includes an illustration prompt and a target image path for each scene. Add your own images at those paths or edit the paths, then pass that JSON to `--storyboard` for local Kokoro narration and rendering.

The CLI only reads paid API credentials when you pass `--paid-topic`. The storyboard, demo, and rerender commands make no paid API calls.

### Demo illustration prompts

The four bundled JPEGs in `demo/` were created with the built-in ImageGen tool. Each prompt used vertical, full-bleed cinematic science-documentary framing with natural film grain and a quiet lower quarter for captions. The palette used deep navy, black, and white-hot amber, with no lettering or logos.

1. A tilted close-up of a stellar black hole with a bright asymmetric amber disk bent over and under the dark shadow.
2. A side-on close-up of turbulent incandescent gas, with intricate copper and ivory filaments in orbital flow.
3. A distant black hole warping a cool-blue background starfield into slender, duplicated arcs around the shadow.
4. A deep-space wide shot with a thin, asymmetric golden arc and a vast field of cold stars.

The moving demo shot is adapted from NASA Goddard Space Flight Center and Jeremy Schnittman’s [Black Hole Accretion Disk Visualization](https://svs.gsfc.nasa.gov/13326/).
