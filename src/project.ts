import {z} from 'zod';
import {diagramSchema} from './diagram.tsx';
import {kokoroVoices} from './kokoro-voices.ts';
import {FPS} from './timing.ts';

export {estimatedCaptions, FPS, narrationCaptions} from './timing.ts';
export const kokoroVoiceSchema = z.enum(Object.keys(kokoroVoices) as (keyof typeof kokoroVoices)[]);

export const maxSceneFrames = FPS * 120;
export const maxProjectFrames = FPS * 600;
export const maxScenes = 100;
export const maxCaptions = 200;
export const sceneName = z.string().trim().min(1).max(200).optional();
export const narrationText = z.string().trim().min(1).max(4000);
export const promptText = z.string().trim().min(1).max(4000);

export const captionSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .refine(({start, end}) => end > start, 'Caption end must follow its start');

export function captionIssue(
  cues: {text: string; start: number; end: number}[],
  index: number,
  frames: number,
) {
  const cue = cues[index];
  if (!captionSchema.safeParse(cue).success) return 'Enter caption text and a valid time range.';
  if (cue.end > frames / FPS + 1e-8) return 'Caption ends after the scene.';
  if (index > 0 && cue.start < cues[index - 1].end) return 'Caption begins before the previous caption ends.';
}
export const sceneMetadata = z.object({
  name: sceneName,
  narration: narrationText,
  kokoroVoice: kokoroVoiceSchema.optional(),
  imagePrompt: promptText.optional(),
  sources: z.string().max(4000).optional(),
});
const localPath = z.string().trim().min(1);
export const projectTitle = z.string().trim().min(1).max(200);
export const projectVersion = z.literal(1).default(1);
export const sceneFrames = z.number().int().positive().max(maxSceneFrames);
export const sceneCaptions = z.array(captionSchema).max(maxCaptions);
export const audioFilename = z.string().regex(/^scene-\d+\.wav$/);
export const storyboardSchema = z.object({
  version: projectVersion,
  title: projectTitle,
  scenes: z
    .array(
      sceneMetadata
        .extend({
          image: localPath.optional(),
          video: localPath.optional(),
          audio: audioFilename.optional(),
          frames: sceneFrames.optional(),
          captions: sceneCaptions.optional(),
        })
        .refine(({image, video}) => !(image && video), 'Choose one visual.'),
    )
    .min(1)
    .max(maxScenes),
  music: localPath.optional(),
  musicVolume: z.number().min(0).max(1).optional(),
});

export const projectSchema = z
  .object({
    version: projectVersion,
    title: projectTitle,
    scenes: z
      .array(
        sceneMetadata
          .extend({
            image: z
              .string()
              .regex(/^scene-\d+\.jpg$/)
              .optional(),
            video: z
              .string()
              .regex(/^scene-\d+\.mp4$/)
              .optional(),
            diagram: diagramSchema.optional(),
            audio: audioFilename,
            frames: sceneFrames,
            captions: sceneCaptions,
          })
          .superRefine((scene, ctx) => {
            if (scene.image && scene.video)
              ctx.addIssue({code: 'custom', path: ['video'], message: 'Choose one visual.'});
            scene.captions.forEach((_, index) => {
              const message = captionIssue(scene.captions, index, scene.frames);
              if (message) ctx.addIssue({code: 'custom', path: ['captions', index], message});
            });
          }),
      )
      .min(1)
      .max(maxScenes),
    music: z.literal('music.wav').optional(),
    musicVolume: z.number().min(0).max(1).optional(),
  })
  .refine(
    ({scenes}) => scenes.reduce((sum, scene) => sum + scene.frames, 0) <= maxProjectFrames,
    'Projects support up to ten minutes.',
  );

export type Project = z.input<typeof projectSchema>;
export type Scene = Project['scenes'][number];
