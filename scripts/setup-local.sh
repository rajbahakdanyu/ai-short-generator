#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "Install FFmpeg to provide $tool." >&2; exit 1; }
done

pnpm install --frozen-lockfile
pnpm setup:voice
bash scripts/setup-topic.sh
node --input-type=module -e "import {ensureBrowser} from '@remotion/renderer'; await ensureBrowser();"
pnpm build
