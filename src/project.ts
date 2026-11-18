import {z} from 'zod';

export const FPS = 30;
const cue = z.object({
  text: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().positive(),
}).refine(({start, end}) => end > start, 'Caption end must follow its start');

export const projectSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(z.object({
    narration: z.string().min(1),
    imagePrompt: z.string().min(1).optional(),
    image: z.string().regex(/^scene-\d+\.jpg$/).optional(),
    audio: z.string().regex(/^scene-\d+\.wav$/),
    frames: z.number().int().positive(),
    captions: z.array(cue),
  })).min(1),
  music: z.literal('music.wav').optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type Scene = Project['scenes'][number];

export function estimatedCaptions(phrases: string[], frames: number): Scene['captions'] {
  // Allow extra time for pauses at the ends of sentences.
  const weights = phrases.map((text) => text.length + (/[.!?]$/.test(text) ? 8 : 0));
  const secondsPerWeight = (frames - 3) / FPS / weights.reduce((sum, weight) => sum + weight, 0);
  let end = 0;
  return phrases.map((text, index) => {
    const start = end;
    end += weights[index] * secondsPerWeight;
    return {text, start, end};
  });
}

export function narrationCaptions(narration: string, frames: number): Scene['captions'] {
  const phrases = narration.match(/[^\s]+(?:[ \t]+[^\s]+){0,4}/g) ?? [narration];
  return estimatedCaptions(phrases, frames);
}
