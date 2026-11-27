import {z} from 'zod';
import {type Diagram, diagramSchema} from './diagram.tsx';
import type {localSettings} from './local-settings.ts';

const narration = z.string().trim().min(1).max(4000);
const sceneNotes = z.object({sources: z.string().max(4000).optional()});
const illustratedScene = z
  .object({narration, imagePrompt: z.string().trim().min(1).max(4000)})
  .extend(sceneNotes.shape);
const animatedScene = z.object({narration, diagram: diagramSchema}).extend(sceneNotes.shape);

export type LocalStoryboard = {
  title: string;
  scenes: (
    | {narration: string; imagePrompt: string; sources?: string}
    | {narration: string; diagram: Diagram; sources?: string}
  )[];
};

export function localStoryboardSchema(settings: Pick<z.infer<typeof localSettings>, 'format' | 'scenes'>) {
  return z.object({
    title: z.string().trim().min(1).max(200),
    scenes: z
      .array(settings.format === 'animated' ? animatedScene : illustratedScene)
      .length(settings.scenes),
  });
}
