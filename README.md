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

Open [Short Studio](http://127.0.0.1:5173/). The bundled black-hole project opens on first launch. Use **Project** to start a blank draft, paste a script with one scene per paragraph, open a project folder, generate from a topic, or reload the sample.

- Add, rename, reorder, or delete scenes. Drop a still image or MP4 into each scene's **Visual** field.
- Pick a **Local voice** for each scene, then use **Generate voice** and **Play** to audition it. Heart is the default. Changing voices resets the recording and caption timing for that scene. Edit caption text and timing in **Captions** after generating the new recording. Install Kokoro with `pnpm setup:voice` if it is missing. The bundled sample can preview and export without installing Kokoro.
- Select **Full Short** in the preview to play and scrub across scenes, or **Scene** to focus on the selected shot. The preview plays available narration and the optional soundtrack.
- Use **Export MP4** to render and download the video. The saved project and MP4 live under `output/studio-*/`. An optional soundtrack is mixed during export.

**Project → Open project folder** opens a folder containing `storyboard.json` or a prepared `project.json` and `assets/`. For a prepared project, Studio reuses the narration, captions, and scene lengths when exporting. For a storyboard, put the referenced stills and clips inside the selected folder.

**Project → Generate from topic** offers storyboard-only, prepare-for-editing, and full MP4 export. Pick the provider and model separately for each stage, or use the values in `.env`. Add any API keys and custom endpoint URLs to `.env` on disk. Keys stay on the local server. Restart Studio after changing `.env`. Generated projects can be opened in the editor from the result dialog or imported later from `output/studio-*/`.

The editor saves one draft plus imported media in the browser on this device. The server listens on loopback. Importing, previewing, and exporting an existing project make no paid API calls.

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

Each run prints a unique directory under `output/` containing the source storyboard, `project.json`, the prepared visuals and narration in `assets/`, and `short.mp4`. Caption timing is estimated from each scene's narration length. Add `--prepare-only` to stop after creating `project.json` and the media files. You can edit captions in `project.json` and rerender without regenerating narration, or open that folder in Studio.

```sh
pnpm generate --render output/your-project-directory
pnpm check
```

### Local narration voices

The existing Kokoro download includes Heart (`af_heart`), Bella (`af_bella`), Michael (`am_michael`), Fenrir (`am_fenrir`), Emma (`bf_emma`), and George (`bm_george`). Heart remains the default. Emma and George speak British English. The others use American English.

Set `"kokoroVoice": "bf_emma"` on individual scenes in `storyboard.json`, or override the voice for the whole run:

```sh
pnpm generate --storyboard path/to/storyboard.json --kokoro-voice bf_emma
```

## Generate from a topic with paid providers

Copy `.env.example` to `.env`. Set `PAID_PROVIDER` to use a single provider for all three stages, or use `SCRIPT_PROVIDER`, `IMAGE_PROVIDER`, and `VOICE_PROVIDER` to mix providers. Stage settings take precedence. With no provider settings, the CLI uses the existing OpenAI defaults and `OPENAI_API_KEY`.

For example, use OpenRouter for the storyboard, fal for the illustrations, and Kokoro on your Mac for narration:

```dotenv
SCRIPT_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key
SCRIPT_MODEL=anthropic/claude-sonnet-4.6

IMAGE_PROVIDER=fal
FAL_KEY=your_fal_key
IMAGE_MODEL=xai/grok-imagine-image

VOICE_PROVIDER=kokoro
```

Run `pnpm setup:voice` once for Kokoro, then generate the Short:

```sh
pnpm generate --paid-topic "Why does the Moon look bigger near the horizon?"
```

### Providers by stage

| Provider value                                                                              | Stages               | API key / configuration                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai`                                                                                    | Script, image, voice | `OPENAI_API_KEY`                                                                                                                                            |
| `openrouter`                                                                                | Script, image, voice | `OPENROUTER_API_KEY`. Select models listed for the respective Chat, Image, and Speech APIs.                                                                 |
| `google`                                                                                    | Script, image, voice | `GOOGLE_API_KEY` or `GEMINI_API_KEY`. Use Gemini text, Gemini image or Imagen, and Gemini TTS models.                                                       |
| `xai`                                                                                       | Script, image, voice | `XAI_API_KEY`. The native xAI speech endpoint uses `VOICE` as the voice ID.                                                                                 |
| `azure`                                                                                     | Script, image, voice | `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_BASE_URL` ending in `/openai/v1`. Use deployment names and enable the relevant endpoint.                           |
| `anthropic`                                                                                 | Script               | `ANTHROPIC_API_KEY`                                                                                                                                         |
| `bedrock`                                                                                   | Script               | `AWS_BEARER_TOKEN_BEDROCK` and `AWS_REGION`. Use a Converse model or inference profile ID.                                                                  |
| `mistral`, `groq`, `deepseek`, `perplexity`, `fireworks`, `deepinfra`, `cerebras`, `cohere` | Script               | `MISTRAL_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `PERPLEXITY_API_KEY`, `FIREWORKS_API_KEY`, `DEEPINFRA_API_KEY`, `CEREBRAS_API_KEY`, `COHERE_API_KEY` |
| `gateway`                                                                                   | Script               | `AI_GATEWAY_API_KEY` for Vercel AI Gateway                                                                                                                  |
| `together`                                                                                  | Script, image        | `TOGETHER_API_KEY`                                                                                                                                          |
| `fal`                                                                                       | Image                | `FAL_KEY` and a text-to-image endpoint ID returning an `images` array                                                                                       |
| `replicate`                                                                                 | Image                | `REPLICATE_API_TOKEN` and a model ID in `owner/model` form returning an image URL                                                                           |
| `elevenlabs`                                                                                | Voice                | `ELEVENLABS_API_KEY`, model ID, and voice ID                                                                                                                |
| `kokoro`                                                                                    | Voice                | Local model installed with `pnpm setup:voice`                                                                                                               |
| `compatible`                                                                                | Script, image, voice | An OpenAI-compatible API URL and key for the endpoints you use                                                                                              |

Set `SCRIPT_MODEL`, `IMAGE_MODEL`, and `VOICE_MODEL` to models that support each stage. Set `VOICE` to the provider's voice name or ID for remote narration. Kokoro defaults to Heart. In Studio, select **Kokoro (local)** to pick a different voice, or pass `--kokoro-voice ID` in the CLI when `VOICE_PROVIDER=kokoro`. The same OpenRouter or Google API key can cover multiple stages, with a different model for each.

For custom endpoints, use `<STAGE>_BASE_URL` and `<STAGE>_API_KEY`, replacing `<STAGE>` with `SCRIPT`, `IMAGE`, or `VOICE`. Existing `OPENAI_BASE_URL` and `OPENAI_API_KEY` setups still work with the default provider. Image tuning accepts `IMAGE_SIZE` for compatible APIs, `IMAGE_ASPECT_RATIO` where supported, and optional JSON `IMAGE_OPTIONS` for model-specific parameters. OpenRouter speech defaults to MP3. Use `VOICE_FORMAT` for a compatible model's supported format.

Add `--plan-only` to call only the script provider and write a storyboard with image prompts:

```sh
pnpm generate --paid-topic "Why does the Moon look bigger near the horizon?" --plan-only
```

Add your own images or MP4 clips to that storyboard and finish with `--storyboard` or open the folder in Studio. Add `--prepare-only` to the full paid command to generate images and narration and stop before rendering. The paid route currently generates still illustrations. Captions and rendering run locally in every mode. Studio only calls paid APIs when you submit **Generate from topic**. The demo, storyboard, and rerender commands make no paid API calls.

### Demo illustration prompts

The four bundled JPEGs in `demo/` were created with the built-in ImageGen tool. Each prompt used vertical, full-bleed cinematic science-documentary framing with natural film grain and a quiet lower quarter for captions. The palette used deep navy, black, and white-hot amber, with no lettering or logos.

1. A tilted close-up of a stellar black hole with a bright asymmetric amber disk bent over and under the dark shadow.
2. A side-on close-up of turbulent incandescent gas, with intricate copper and ivory filaments in orbital flow.
3. A distant black hole warping a cool-blue background starfield into slender, duplicated arcs around the shadow.
4. A deep-space wide shot with a thin, asymmetric golden arc and a vast field of cold stars.

The moving demo shot is adapted from NASA Goddard Space Flight Center and Jeremy Schnittman’s [Black Hole Accretion Disk Visualization](https://svs.gsfc.nasa.gov/13326/).
