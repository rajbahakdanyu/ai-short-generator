import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import {writeJson} from './checkpoint.ts';
import {diagramSchema} from './diagram.tsx';
import {localSettings} from './local-settings.ts';
import {type LocalStoryboard, localStoryboardSchema} from './local-storyboard.ts';
import {renderDiagrams} from './render.ts';
import {buildStoryboard, readStoryboard} from './storyboard.ts';

const execute = promisify(execFile);
export const localTopic = z.string().trim().min(1).max(500);

async function checkLocalModels(settings: z.output<typeof localSettings>) {
  const models = resolve('.local-models');
  const python = join(models, 'venv/bin/python');
  const modelPath = (path: string) => resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
  const imageModel = modelPath(settings.imageModel);
  const speech = {model: modelPath(settings.voiceModel), voices: modelPath(settings.voiceBank)};
  const imageFiles = settings.format === 'animated' ? [] : [python, join(imageModel, 'model_index.json')];
  await Promise.all(
    [speech.model, speech.voices, ...imageFiles].map(async (path) => {
      try {
        await access(path);
      } catch {
        throw new Error(
          `Missing local model or runtime: ${path}. Check your model settings or run pnpm setup:local.`,
        );
      }
    }),
  );
  return {imageModel, speech, python};
}

export async function planLocalTopic(
  topic: string,
  report: (message: string) => void,
  signal?: AbortSignal,
  options?: z.input<typeof localSettings>,
) {
  const settings = localSettings.parse(options ?? {});
  const animated = settings.format === 'animated';
  const modelPath = (path: string) => resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
  const weights = modelPath(settings.scriptModel);
  await access(weights).catch(() => {
    throw new Error(`Missing script model: ${weights}. Check your model settings or run pnpm setup:local.`);
  });
  const plan = localStoryboardSchema(settings);
  const visualInstruction = animated
    ? 'Explain the concept step by step. Each diagram shows exactly three named objects. Copy specific nouns from the topic into the labels. In a pipeline connect the three labels in order. In fan-out the first label sends to the other two; in fan-in the first two send to the third. Follow any layout requested by the user. Narrate only what this diagram shows in one sentence under 22 words.'
    : 'Each imagePrompt describes visible subjects and setting for that sentence.';
  const audience = {
    general: 'a general audience',
    beginner: 'beginners with no assumed background knowledge',
    intermediate: 'an audience familiar with the basics',
  }[settings.audience];
  const prompt = `Write a short educational video about ${localTopic.parse(topic)} for ${audience}. Target about ${settings.targetDurationSeconds} seconds of spoken narration. Give it a title and exactly ${settings.scenes} scenes. Each narration is one clear, accurate spoken sentence. ${visualInstruction} Return JSON only.`;
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
  return plan.parse(JSON.parse(stdout.slice(start, end + 1))) as LocalStoryboard;
}

export async function prepareLocalStoryboard(
  board: LocalStoryboard,
  directory: string,
  report: (message: string) => void,
  signal?: AbortSignal,
  options?: z.input<typeof localSettings>,
) {
  const settings = localSettings.parse(options ?? {});
  const validatedBoard = localStoryboardSchema(settings).parse(board) as LocalStoryboard;
  const animated = settings.format === 'animated';
  const {imageModel, speech, python} = await checkLocalModels(settings);
  const path = join(directory, 'local-storyboard.json');
  await writeJson(path, {
    ...validatedBoard,
    settings,
    scenes: validatedBoard.scenes.map((scene, index) => ({
      ...scene,
      kokoroVoice: settings.voice,
      ...(animated
        ? {
            video: `diagram-${index + 1}.mp4`,
            name: 'diagram' in scene ? scene.diagram.heading : undefined,
          }
        : {image: `illustration-${index + 1}.png`}),
    })),
  });
  if (animated) {
    report('Animating diagrams');
    await renderDiagrams(
      directory,
      validatedBoard.scenes
        .map((item) => ('diagram' in item ? diagramSchema.parse(item.diagram) : undefined))
        .filter((diagram) => diagram !== undefined),
      signal,
    );
  } else {
    report(`Illustrating scenes with ${basename(imageModel)}`);
    await execute(python, [resolve('scripts/local-images.py'), directory, imageModel], {
      signal,
      killSignal: 'SIGKILL',
      timeout: 900000,
      env: {...process.env, HF_HUB_OFFLINE: '1'},
    });
  }
  report('Generating narration and captions');
  const project = await buildStoryboard(await readStoryboard(path), directory, [], undefined, signal, speech);
  if (animated) {
    project.scenes.forEach((scene, index) => {
      const item = validatedBoard.scenes[index];
      if ('diagram' in item) scene.diagram = item.diagram;
    });
  }
  return project;
}

export async function buildLocalTopic(
  topic: string,
  directory: string,
  report: (message: string) => void,
  signal?: AbortSignal,
  options?: z.input<typeof localSettings>,
) {
  const settings = localSettings.parse(options ?? {});
  await checkLocalModels(settings);
  const board = await planLocalTopic(topic, report, signal, settings);
  return prepareLocalStoryboard(board, directory, report, signal, settings);
}
