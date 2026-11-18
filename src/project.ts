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
    imagePrompt: z.string().min(1),
    image: z.string().regex(/^scene-\d+\.jpg$/).optional(),
    audio: z.string().regex(/^scene-\d+\.wav$/),
    frames: z.number().int().positive(),
    captions: z.array(cue),
  })).min(1),
  music: z.literal('music.wav').optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type Scene = Project['scenes'][number];

export function groupWords(words: {word: string; start: number; end: number}[]) {
  const cues: Scene['captions'] = [];
  let group: typeof words = [];
  for (const word of words) {
    if (!word.word.trim() || word.end <= word.start || word.start < 0) continue;
    group.push(word);
    if (group.length === 5 || /[.!?]$/.test(word.word.trim()) || word === words.at(-1)) {
      cues.push({
        text: group.map(({word}) => word.trim()).join(' '),
        start: group[0].start,
        end: word.end,
      });
      group = [];
    }
  }
  if (group.length) {
    cues.push({
      text: group.map(({word}) => word.trim()).join(' '),
      start: group[0].start,
      end: group[group.length - 1].end,
    });
  }
  return cues;
}
