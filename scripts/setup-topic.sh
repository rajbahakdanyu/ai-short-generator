#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v llama-completion >/dev/null || brew install llama.cpp
mkdir -p .local-models
fetch() {
  local url=$1 target=$2
  if [[ ! -s "$target" ]]; then
    mkdir -p "$(dirname "$target")"
    curl --fail --location --retry 3 "$url" --output "$target.partial"
    mv "$target.partial" "$target"
  fi
}
fetch https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/f9c28bcd85737ffc5aef028638d3341d49869c27/gemma-3-1b-it-Q4_K_M.gguf .local-models/script.gguf
base=https://huggingface.co/stabilityai/sd-turbo/resolve/b261bac6fd2cf515557d5d0707481eafa0485ec2
for file in model_index.json scheduler/scheduler_config.json text_encoder/{config.json,model.fp16.safetensors} tokenizer/{merges.txt,special_tokens_map.json,tokenizer_config.json,vocab.json} unet/{config.json,diffusion_pytorch_model.fp16.safetensors} vae/{config.json,diffusion_pytorch_model.fp16.safetensors}; do
  fetch "$base/$file" ".local-models/sd-turbo/$file"
done
python3.12 -m venv .local-models/venv
.local-models/venv/bin/python -m pip install 'diffusers==0.35.2' 'transformers==4.57.3' 'accelerate==1.16.0' 'torch==2.15.0' 'pillow==13.0.0' 'safetensors==0.8.0'
