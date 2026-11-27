import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import {writeJson} from './checkpoint.ts';
import {localSettings} from './local-settings.ts';
import {buildStoryboard, readStoryboard} from './storyboard.ts';

const execute = promisify(execFile);
const scene = z.object({
  narration: z.string().trim().min(1).max(800),
  imagePrompt: z.string().trim().min(1).max(800),
});
export const localTopic = z.string().trim().min(1).max(500);

export async function buildLocalTopic(
  topic: string,
  directory: string,
  report: (message: string) => void,
  signal?: AbortSignal,
  options?: z.input<typeof localSettings>,
) {
  const settings = localSettings.parse(options ?? {});
  const plan = z.object({
    title: z.string().trim().min(1).max(200),
    scenes: z.array(scene).length(settings.scenes),
  });
  const models = resolve('.local-models');
  const python = join(models, 'venv/bin/python');
  const modelPath = (path: string) => resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
  const weights = modelPath(settings.scriptModel);
  const imageModel = modelPath(settings.imageModel);
  const speech = {model: modelPath(settings.voiceModel), voices: modelPath(settings.voiceBank)};
  await Promise.all(
    [weights, python, join(imageModel, 'model_index.json'), speech.model, speech.voices].map(async (path) => {
      try {
        await access(path);
      } catch {
        throw new Error(
          `Missing local model or runtime: ${path}. Check your model settings or run pnpm setup:local.`,
        );
      }
    }),
  );
  const prompt = `Write a short educational video about ${localTopic.parse(topic)}. Give it a title and exactly ${settings.scenes} scenes. Each narration is one clear, accurate spoken sentence. Each imagePrompt describes visible subjects and setting for that sentence. Return JSON only.`;
  report(`Writing the script with ${basename(weights)}`);
  const {stdout} = await execute(
    'llama-completion',
    [
      '-m',
      weights,
      '-p',
      prompt,
      '-n',
      String(256 * settings.scenes + 128),
      '-c',
      '4096',
      '--conversation',
      '--single-turn',
      '--no-display-prompt',
      '--json-schema',
      JSON.stringify(z.toJSONSchema(plan)),
    ],
    {signal, timeout: 300000},
  );
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The local model did not return a storyboard.');
  const board = plan.parse(JSON.parse(stdout.slice(start, end + 1)));
  const path = join(directory, 'local-storyboard.json');
  await writeJson(path, {
    ...board,
    settings,
    scenes: board.scenes.map((scene, i) => ({
      ...scene,
      kokoroVoice: settings.voice,
      image: `illustration-${i + 1}.png`,
    })),
  });
  report(`Illustrating scenes with ${basename(imageModel)}`);
  await execute(python, [resolve('scripts/local-images.py'), directory, imageModel], {
    signal,
    killSignal: 'SIGKILL',
    timeout: 900000,
    env: {...process.env, HF_HUB_OFFLINE: '1'},
  });
  report('Generating narration and captions');
  return buildStoryboard(await readStoryboard(path), directory, [], undefined, signal, speech);
}
