import {access, copyFile, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultKokoroVoice, type KokoroVoice} from './kokoro-voices.ts';
import {audioFrames, fitVideoToScene, normalizeSpeech, run, toJpeg} from './media.ts';
import {narrationCaptions, type Project, type Scene, storyboardSchema} from './project.ts';

export async function readStoryboard(path: string) {
  const board = storyboardSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const scenes = board.scenes.map((scene, index) => {
    if (scene.video) return {...scene, image: undefined, video: resolve(dirname(path), scene.video)};
    if (scene.image) return {...scene, image: resolve(dirname(path), scene.image), video: undefined};
    throw new Error(`Scene ${index + 1} needs an image or video.`);
  });
  for (const [index, scene] of scenes.entries()) {
    const visual = scene.video ?? scene.image;
    try {
      await access(visual);
    } catch {
      throw new Error(`Scene ${index + 1} visual could not be opened: ${visual}`);
    }
  }
  return {...board, scenes};
}

export async function kokoroRuntime() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const python = join(root, '.kokoro/venv/bin/python');
  try {
    await Promise.all([
      access(python),
      access(join(root, '.kokoro/kokoro-v1.0.onnx')),
      access(join(root, '.kokoro/voices-v1.0.bin')),
    ]);
  } catch {
    throw new Error('Kokoro is missing. Run pnpm setup:voice from the project directory.');
  }

  return {python, root};
}

export async function generateNarration(
  scenes: {index: number; narration: string; kokoroVoice?: KokoroVoice}[],
  directory: string,
  assets: string,
  label = 'batch',
  signal?: AbortSignal,
) {
  if (!scenes.length) return;
  const {python, root} = await kokoroRuntime();
  const input = join(directory, `narration-input-${label}.json`);
  await writeFile(
    input,
    JSON.stringify({
      scenes: scenes.map((scene) => ({...scene, kokoroVoice: scene.kokoroVoice ?? defaultKokoroVoice})),
    }),
  );
  try {
    console.log('Generating narration locally with Kokoro');
    await run(python, [join(root, 'scripts/narrate.py'), input, assets], signal);
    for (const {index} of scenes) {
      signal?.throwIfAborted();
      const speech = join(assets, `speech-${index}.wav`);
      await normalizeSpeech(speech, join(assets, `scene-${index}.wav`), signal);
      await rm(speech);
    }
  } finally {
    await rm(input, {force: true});
  }
}

export async function buildStoryboard(
  board: Awaited<ReturnType<typeof readStoryboard>>,
  directory: string,
  prepared: {voice?: string; captions?: Scene['captions']; frames?: number}[] = [],
  onScene?: (index: number) => void,
  signal?: AbortSignal,
): Promise<Project> {
  const assets = join(directory, 'assets');
  await writeFile(join(directory, 'storyboard.json'), `${JSON.stringify(board, null, 2)}\n`);
  await generateNarration(
    board.scenes.flatMap(({narration, kokoroVoice}, index) =>
      prepared[index]?.voice ? [] : [{narration, kokoroVoice, index: index + 1}],
    ),
    directory,
    assets,
    'batch',
    signal,
  );
  const scenes: Project['scenes'] = [];
  for (const [index, scene] of board.scenes.entries()) {
    signal?.throwIfAborted();
    onScene?.(index);
    const id = `scene-${index + 1}`;
    const audio = `${id}.wav`;
    const output = join(assets, audio);
    const voice = prepared[index]?.voice;
    if (voice) await copyFile(voice, output);
    const frames = prepared[index]?.frames ?? (await audioFrames(output, signal));
    const captions = prepared[index]?.captions ?? narrationCaptions(scene.narration, frames);
    if (scene.video !== undefined) {
      const video = `${id}.mp4`;
      await fitVideoToScene(scene.video, join(assets, video), frames, signal);
      scenes.push({
        name: scene.name,
        sources: scene.sources,
        narration: scene.narration,
        kokoroVoice: scene.kokoroVoice,
        imagePrompt: scene.imagePrompt,
        video,
        audio,
        frames,
        captions,
      });
    } else {
      const image = `${id}.jpg`;
      await toJpeg(scene.image, join(assets, image), signal);
      scenes.push({
        name: scene.name,
        sources: scene.sources,
        narration: scene.narration,
        kokoroVoice: scene.kokoroVoice,
        imagePrompt: scene.imagePrompt,
        image,
        audio,
        frames,
        captions,
      });
    }
  }
  return {title: board.title, scenes};
}
