import {z} from 'zod';
import {kokoroVoices} from './kokoro-voices.ts';

export {estimatedCaptions, FPS, narrationCaptions} from './timing.ts';
export const kokoroVoiceSchema = z.enum(Object.keys(kokoroVoices) as (keyof typeof kokoroVoices)[]);

export const captionSchema = z
  .object({
    text: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .refine(({start, end}) => end > start, 'Caption end must follow its start');

export const projectSchema = z.object({
  title: z.string().min(1),
  scenes: z
    .array(
      z.object({
        narration: z.string().min(1),
        kokoroVoice: kokoroVoiceSchema.optional(),
        imagePrompt: z.string().min(1).optional(),
        image: z
          .string()
          .regex(/^scene-\d+\.jpg$/)
          .optional(),
        video: z
          .string()
          .regex(/^scene-\d+\.mp4$/)
          .optional(),
        audio: z.string().regex(/^scene-\d+\.wav$/),
        frames: z.number().int().positive(),
        captions: z.array(captionSchema),
      }),
    )
    .min(1),
  music: z.literal('music.wav').optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type Scene = Project['scenes'][number];
