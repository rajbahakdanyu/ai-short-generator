# AI Short Generator

Turn a topic into a narrated, illustrated educational Short. OpenAI generates an eight-scene storyboard, portrait illustrations, voiceover, and word timestamps. Remotion assembles the assets on your Mac with slow pans, zooms, caption overlays, and an optional music bed.

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

The macOS demo uses four bundled black hole illustrations, system speech, estimated phrase-level caption timing, and a locally synthesized ambient bed. It makes no OpenAI calls.

## Generate from a topic

```sh
cp .env.example .env
# Add your OpenAI API key to .env.
pnpm generate "Why does time slow down near a black hole?"
```

To add background music, append `--music /path/to/licensed-track.mp3`. The renderer loops the track underneath the narration at reduced volume and fades it in and out.

The final video is a 1080 × 1920, 30 fps H.264 MP4 with AAC audio. The storyboard targets roughly 45 seconds. The actual length follows the generated narration.

Each run prints its unique directory under `output/`. It contains `project.json`, the source media in `assets/`, and the finished `short.mp4`. You can edit caption text or timing in `project.json` and render again without making any API calls.

```sh
pnpm generate --render output/your-project-directory
pnpm check
```

Topic generation uses billable OpenAI endpoints. Keep `.env` local and check that your API project has access to the configured models. Review facts, narration, and captions before publishing. Upload the MP4 manually to your chosen platforms.

### Demo illustration prompts

The four bundled JPEGs in `demo/` were created with the built-in ImageGen tool. Each prompt used vertical, full-bleed cinematic science-documentary framing with natural film grain and a quiet lower quarter for captions. The palette used deep navy, black, and white-hot amber, with no lettering or logos.

1. A tilted close-up of a stellar black hole with a bright asymmetric amber disk bent over and under the dark shadow.
2. A side-on close-up of turbulent incandescent gas, with intricate copper and ivory filaments in orbital flow.
3. A distant black hole warping a cool-blue background starfield into slender, duplicated arcs around the shadow.
4. A deep-space wide shot with a thin, asymmetric golden arc and a vast field of cold stars.
