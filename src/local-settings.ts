import {z} from 'zod';
import {defaultKokoroVoice} from './kokoro-voices.ts';
import {kokoroVoiceSchema} from './project.ts';

export const localSettings = z.object({
  scenes: z.number().int().min(1).max(6).default(3),
  voice: kokoroVoiceSchema.default(defaultKokoroVoice),
  style: z.string().trim().min(1).max(150).default('Editorial science illustration'),
});
