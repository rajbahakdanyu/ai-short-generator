import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
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
  const weights = join(models, 'script.gguf');
  await Promise.all(
    [weights, python, join(models, 'sd-turbo/model_index.json')].map((path) => access(path)),
  ).catch(() => {
    throw new Error('Local topic generation needs model files. Run pnpm setup:local.');
  });
  const prompt = `<start_of_turn>user\nWrite a short educational video about ${localTopic.parse(topic)}. Give it a title and exactly ${settings.scenes} scenes. Each narration is one clear, accurate spoken sentence. Each imagePrompt describes visible subjects and setting for that sentence. Return JSON only.<end_of_turn>\n<start_of_turn>model\n`;
  report('Writing the script with Gemma');
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
      '--no-conversation',
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
  report('Illustrating scenes with SD-Turbo');
  await execute(python, [resolve('scripts/local-images.py'), directory], {
    signal,
    killSignal: 'SIGKILL',
    timeout: 900000,
    env: {...process.env, HF_HUB_OFFLINE: '1'},
  });
  report('Generating narration and captions');
  return buildStoryboard(await readStoryboard(path), directory, [], undefined, signal);
}
