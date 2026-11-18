import {join} from 'node:path';
import {z} from 'zod';
import {readOptional, writeAtomic, writeJson} from './checkpoint.ts';
import {audioFrames, fitVideoToScene, normalizeSpeech, toJpeg} from './media.ts';
import {narrationCaptions, type Project, promptText, sceneMetadata} from './project.ts';
import type {PaidProviders, RemoteConfig} from './providers/config.ts';
import {generateImage} from './providers/image.ts';
import {generateScript} from './providers/script.ts';
import {generateClip} from './providers/video.ts';
import {generateVoice} from './providers/voice.ts';
import {generateNarration, kokoroRuntime} from './storyboard.ts';

export const paidBoardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scenes: z
    .array(sceneMetadata.extend({imagePrompt: promptText}))
    .min(1)
    .max(8),
});

export type PaidStage = 'script' | 'visual' | 'voice';

type GenerationOptions = {
  beforeRequest?: (stage: PaidStage) => Promise<void>;
  report?: (detail: string, progress: number) => Promise<void>;
  videoKey?: string;
  signal?: AbortSignal;
  approvedBoard?: z.infer<typeof paidBoardSchema>;
};

async function generateBoard(script: RemoteConfig, topic: string) {
  const system = [
    'Write an accurate English educational Short with eight scenes and approximately 100 spoken words total.',
    'Open with a concrete question or surprising fact, then resolve it. Skip intros and calls to subscribe.',
    'Return only a JSON object of the shape {"title":"...","scenes":[{"name":"...","narration":"...","imagePrompt":"..."}]}.',
    'Each narration is spoken text. Each image prompt describes a distinct portrait visual for that beat.',
    'Vary framing and composition across scenes while keeping the visual palette consistent.',
  ].join(' ');
  const text = (await generateScript(script, system, topic)).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/gi, ''));
  } catch {
    throw new Error('The provider returned an invalid JSON storyboard.');
  }
  return paidBoardSchema.parse(parsed);
}

export async function buildPaidShort(
  {script, image, voice}: PaidProviders,
  topic: string,
  directory: string,
  {report, videoKey, signal, approvedBoard, beforeRequest}: GenerationOptions = {},
): Promise<Project | string> {
  if (voice?.provider === 'kokoro') await kokoroRuntime();
  const storyboardFile = join(directory, 'storyboard.json');
  const saved = await readOptional(storyboardFile);
  let board: z.infer<typeof paidBoardSchema>;
  if (saved) board = paidBoardSchema.parse(JSON.parse(saved.toString()));
  else {
    await report?.('Writing storyboard', 0);
    if (approvedBoard) board = approvedBoard;
    else {
      if (!script) throw new Error('Select a script provider to create the storyboard.');
      await beforeRequest?.('script');
      board = await generateBoard({...script, signal}, topic);
    }
    await writeJson(storyboardFile, board);
  }
  await report?.('Storyboard saved', 0.08);
  if ((!image && !videoKey) || !voice) return storyboardFile;

  const assets = join(directory, 'assets');
  let completed = 0;
  const scenes: Project['scenes'] = [];
  const update = (index: number, detail: string) =>
    report?.(
      `Scene ${index + 1} of ${board.scenes.length} · ${detail}`,
      0.08 + (0.92 * completed) / board.scenes.length,
    );
  async function prepare(index: number) {
    const scene = board.scenes[index];
    const id = `scene-${index + 1}`;
    const visual = join(assets, `${id}.source`);
    const speech = join(assets, `${id}.speech`);
    const audio = `${id}.wav`;
    const voicePath = join(assets, audio);
    const finished = join(directory, `${id}.json`);
    const checkpoint = await readOptional(finished);
    if (checkpoint) {
      scenes[index] = JSON.parse(checkpoint.toString());
    } else {
      signal?.throwIfAborted();
      await update(index, videoKey ? 'generating video' : 'generating illustration');
      if (!(await readOptional(visual))) {
        const prompt = `${scene.imagePrompt} Cinematic portrait framing with the subject in the central 80%. No text or logos.`;
        if (!videoKey) await beforeRequest?.('visual');
        const bytes = videoKey
          ? await generateClip(videoKey, prompt, join(directory, `${id}.fal-request`), {
              signal,
              report: (status) => update(index, status),
              beforeSubmit: () => beforeRequest?.('visual'),
            })
          : image && (await generateImage({...image, signal}, prompt));
        if (!bytes) throw new Error('Select an image provider.');
        await writeAtomic(visual, bytes);
      }
      signal?.throwIfAborted();
      await update(index, 'generating narration');
      if (voice?.provider === 'kokoro') {
        await generateNarration(
          [{narration: scene.narration, kokoroVoice: voice.voice, index: index + 1}],
          directory,
          assets,
          id,
          signal,
        );
      } else if (voice) {
        if (!(await readOptional(speech))) {
          await beforeRequest?.('voice');
          await writeAtomic(speech, await generateVoice({...voice, signal}, scene.narration));
        }
        await normalizeSpeech(speech, voicePath, signal);
      }
      const frames = await audioFrames(voicePath, signal);
      const filename = `${id}.${videoKey ? 'mp4' : 'jpg'}`;
      if (videoKey) await fitVideoToScene(visual, join(assets, filename), frames, signal);
      else await toJpeg(visual, join(assets, filename), signal);
      const prepared = {
        ...scene,
        kokoroVoice: voice?.provider === 'kokoro' ? voice.voice : undefined,
        ...(videoKey ? {video: filename} : {image: filename}),
        audio,
        frames,
        captions: narrationCaptions(scene.narration, frames),
      };
      await writeJson(finished, prepared);
      scenes[index] = prepared;
    }
    completed++;
    await update(index, 'ready');
  }

  // Let in-flight scenes finish checkpointing before releasing the job on failure.
  const parallel = voice.provider === 'kokoro' ? 1 : 2;
  for (let start = 0; start < board.scenes.length; start += parallel) {
    signal?.throwIfAborted();
    const batch = board.scenes.slice(start, start + parallel);
    const results = await Promise.allSettled(batch.map((_, offset) => prepare(start + offset)));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  return {title: board.title, scenes};
}
