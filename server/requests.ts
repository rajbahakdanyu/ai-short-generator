import {z} from 'zod';
import {localSettings} from '../src/local-settings.ts';
import {localTopic} from '../src/local-topic.ts';
import {paidBoardSchema} from '../src/paid.ts';
import {
  kokoroVoiceSchema,
  maxScenes,
  projectTitle,
  sceneCaptions,
  sceneFrames,
  sceneMetadata,
} from '../src/project.ts';
import {idPattern} from './jobs.ts';

export const exportRequest = z.object({
  title: projectTitle,
  musicVolume: z.number().min(0).max(1).optional(),
  scenes: z
    .array(
      sceneMetadata.extend({
        kind: z.enum(['image', 'video']),
        captions: sceneCaptions.optional(),
        frames: sceneFrames.optional(),
      }),
    )
    .min(1)
    .max(maxScenes),
});

const providerPick = z.object({
  provider: z.string().trim().min(1).max(50).optional(),
  model: z.string().trim().min(1).max(300).optional(),
  apiKey: z.string().trim().min(1).max(1500).optional(),
  baseUrl: z.string().trim().min(1).max(1000).optional(),
});

export const paidRequest = z.object({
  topic: z.string().trim().max(4000).default(''),
  board: paidBoardSchema.optional(),
  video: z.boolean().default(false),
  videoKey: z.string().trim().min(1).max(1500).optional(),
  resumeLimit: z.number().nonnegative().optional(),
  estimate: z
    .object({
      script: z.number().nonnegative(),
      visual: z.number().nonnegative(),
      voice: z.number().nonnegative(),
      limit: z.number().nonnegative(),
    })
    .optional(),
  mode: z.enum(['plan', 'prepare', 'export']),
  selection: z
    .object({
      script: providerPick.optional(),
      image: providerPick
        .extend({
          size: z.string().trim().min(1).max(50).optional(),
          aspectRatio: z.string().trim().min(1).max(30).optional(),
          options: z.string().trim().min(1).max(5000).optional(),
        })
        .optional(),
      voice: providerPick
        .extend({
          voice: z.string().trim().min(1).max(200).optional(),
          format: z.enum(['wav', 'mp3', 'flac', 'aac', 'opus', 'pcm']).optional(),
        })
        .optional(),
    })
    .optional(),
});
export type PaidRequest = z.infer<typeof paidRequest>;

export const localMode = z.object({mode: z.enum(['direct', 'plan', 'prepare'])});
export const localGenerationRequest = localSettings.extend({
  topic: localTopic,
  mode: z.enum(['direct', 'plan']),
});
export const localPrepareRequest = z.object({
  mode: z.literal('prepare'),
  planId: z.string().regex(idPattern),
  board: z.unknown(),
});

export const voiceRequest = z.object({
  narration: z.string().trim().min(1).max(4000),
  kokoroVoice: kokoroVoiceSchema.optional(),
});
