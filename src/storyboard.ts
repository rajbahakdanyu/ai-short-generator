import {access, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {audioFrames, normalizeSpeech, run, toJpeg} from './media.ts';
import {narrationCaptions, type Project} from './project.ts';

const storyboardSchema = z.object({
  title: z.string().trim().min(1),
  scenes: z.array(z.object({
    narration: z.string().trim().min(1),
    image: z.string().trim().min(1),
  })).min(1),
});

export async function readStoryboard(path: string) {
  const board = storyboardSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const scenes = board.scenes.map((scene) => ({
    ...scene,
    image: resolve(dirname(path), scene.image),
  }));
  for (const [index, scene] of scenes.entries()) {
    try {
      await access(scene.image);
    } catch {
      throw new Error(`Scene ${index + 1} image could not be opened: ${scene.image}`);
    }
  }
  return {...board, scenes};
}

export async function buildStoryboard(
  board: Awaited<ReturnType<typeof readStoryboard>>,
  directory: string,
): Promise<Project> {
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

  const input = join(directory, 'storyboard.json');
  const assets = join(directory, 'assets');
  await writeFile(input, JSON.stringify(board, null, 2) + '\n');
  for (const [index, scene] of board.scenes.entries()) {
    await toJpeg(scene.image, join(assets, `scene-${index + 1}.jpg`));
  }

  console.log('Generating narration locally with Kokoro');
  await run(python, [join(root, 'scripts/narrate.py'), input, assets]);
  const scenes: Project['scenes'] = [];
  for (const [index, scene] of board.scenes.entries()) {
    const image = `scene-${index + 1}.jpg`;
    const audio = `scene-${index + 1}.wav`;
    const speech = join(assets, `speech-${index + 1}.wav`);
    const output = join(assets, audio);
    await normalizeSpeech(speech, output);
    await rm(speech);
    const frames = await audioFrames(output);
    scenes.push({narration: scene.narration, image, audio, frames, captions: narrationCaptions(scene.narration, frames)});
  }
  return {title: board.title, scenes};
}
