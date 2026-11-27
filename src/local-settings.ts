import {z} from 'zod';
import {defaultKokoroVoice} from './kokoro-voices.ts';
import {kokoroVoiceSchema} from './project.ts';

export const localModelDefaults = {
  scriptModel: '.local-models/script.gguf',
  imageModel: '.local-models/sd-turbo',
  voiceModel: '.kokoro/kokoro-v1.0.onnx',
  voiceBank: '.kokoro/voices-v1.0.bin',
};
const modelPath = z.string().trim().min(1).max(4096);
export const localSettings = z.object({
  scriptModel: modelPath.default(localModelDefaults.scriptModel),
  imageModel: modelPath.default(localModelDefaults.imageModel),
  voiceModel: modelPath.default(localModelDefaults.voiceModel),
  voiceBank: modelPath.default(localModelDefaults.voiceBank),
  imagePreset: z.enum(['turbo', 'standard', 'sdxl']).default('turbo'),
  scenes: z.number().int().min(1).max(6).default(3),
  voice: kokoroVoiceSchema.default(defaultKokoroVoice),
  style: z.string().trim().min(1).max(150).default('Editorial science illustration'),
});
