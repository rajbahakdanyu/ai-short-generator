import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {demoProject} from './demo.ts';
import {run, toWav} from './media.ts';
import {buildPaidShort, paidProvider} from './paid.ts';
import {FPS, projectSchema} from './project.ts';
import {renderShort} from './render.ts';
import {buildStoryboard, readStoryboard} from './storyboard.ts';

const usage = `Usage
  pnpm generate --storyboard path/to/storyboard.json [--music path/to/track.mp3]
  pnpm generate --paid-topic "Your topic" [--music path/to/track.mp3]
  pnpm generate --paid-topic "Your topic" --plan-only
  pnpm generate --demo [--music path/to/track.mp3]
  pnpm generate --render output/your-project
`;

async function main() {
  const {values} = parseArgs({
    options: {
      demo: {type: 'boolean'},
      storyboard: {type: 'string'},
      'paid-topic': {type: 'string'},
      'plan-only': {type: 'boolean'},
      render: {type: 'string'},
      music: {type: 'string'},
      help: {type: 'boolean', short: 'h'},
    },
  });

  if (values.help) {
    console.log(usage);
    return;
  }
  const topic = values['paid-topic']?.trim();
  const planOnly = values['plan-only'] ?? false;
  const modes = [values.storyboard, values.demo, values.render, topic].filter(Boolean);
  if (
    modes.length !== 1 ||
    (planOnly && !topic) ||
    ((values.render || planOnly) && values.music !== undefined)
  ) {
    throw new Error(usage);
  }
  if (values.render) {
    console.log(await renderShort(resolve(values.render)));
    return;
  }

  const board = values.storyboard ? await readStoryboard(resolve(values.storyboard)) : undefined;
  const provider = topic ? paidProvider() : undefined;
  if (!planOnly) {
    await run('ffprobe', ['-version']);
    await run('ffmpeg', ['-version']);
  }

  const slug = (board?.title ?? topic)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  const output = resolve('output');
  await mkdir(output, {recursive: true});
  const directory = await mkdtemp(join(output, `${slug || (values.demo ? 'demo' : 'short')}-`));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  console.log(`Project directory ${directory}`);
  let music: 'music.wav' | undefined;
  if (values.music !== undefined) {
    music = 'music.wav';
    await toWav(resolve(values.music), join(assets, music));
  }
  const result =
    topic && provider
      ? await buildPaidShort(provider, topic, directory, planOnly)
      : board
        ? await buildStoryboard(board, directory)
        : await demoProject(assets, music);
  if (typeof result === 'string') {
    console.log(`Storyboard saved to ${result}`);
    return;
  }
  const project = projectSchema.parse({...result, ...(music && {music})});
  await writeFile(join(directory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  const seconds = project.scenes.reduce((sum, scene) => sum + scene.frames, 0) / FPS;
  console.log(`${project.title} · ${seconds.toFixed(1)} seconds`);
  console.log(await renderShort(directory));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
