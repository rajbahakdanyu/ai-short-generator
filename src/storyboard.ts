import {access, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {audioFrames, fitVideoToScene, normalizeSpeech, run, toJpeg} from './media.ts';
import {narrationCaptions, type Project} from './project.ts';

const localPath = z.string().trim().min(1);
const narration = z.string().trim().min(1);
const storyboardSchema = z.object({
  title: z.string().trim().min(1),
  scenes: z.array(z.union([
    z.object({narration, image: localPath, video: z.never().optional()}),
    z.object({narration, video: localPath, image: z.never().optional()}),
  ])).min(1),
});

export async function readStoryboard(path: string) {
  const board = storyboardSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const scenes = board.scenes.map((scene) => scene.video !== undefined
    ? {...scene, video: resolve(dirname(path), scene.video)}
    : {...scene, image: resolve(dirname(path), scene.image)});
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
  console.log('Generating narration locally with Kokoro');
  await run(python, [join(root, 'scripts/narrate.py'), input, assets]);
  const scenes: Project['scenes'] = [];
  for (const [index, scene] of board.scenes.entries()) {
    const id = `scene-${index + 1}`;
    const audio = `scene-${index + 1}.wav`;
    const speech = join(assets, `speech-${index + 1}.wav`);
    const output = join(assets, audio);
    await normalizeSpeech(speech, output);
    await rm(speech);
    const frames = await audioFrames(output);
    const captions = narrationCaptions(scene.narration, frames);
    if (scene.video !== undefined) {
      const video = `${id}.mp4`;
      await fitVideoToScene(scene.video, join(assets, video), frames);
      scenes.push({narration: scene.narration, video, audio, frames, captions});
    } else {
      const image = `${id}.jpg`;
      await toJpeg(scene.image, join(assets, image));
      scenes.push({narration: scene.narration, image, audio, frames, captions});
    }
  }
  return {title: board.title, scenes};
}
