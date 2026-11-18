#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p .kokoro
python3 -m venv .kokoro/venv
.kokoro/venv/bin/python -m pip install 'kokoro-onnx==0.6.1' 'soundfile==0.14.0'

release=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1
for asset in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [[ ! -s ".kokoro/$asset" ]]; then
    curl --fail --location --retry 2 "$release/$asset" --output ".kokoro/$asset.partial"
    mv ".kokoro/$asset.partial" ".kokoro/$asset"
  fi
done
