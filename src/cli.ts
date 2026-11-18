import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {parseArgs} from 'node:util';
import {demoProject} from './demo.ts';
import {generateProject} from './generation.ts';
import {run, toWav} from './media.ts';
import {FPS, projectSchema} from './project.ts';
import {renderShort} from './render.ts';

const usage = `Usage
  pnpm generate "Your topic" [--music path/to/track.mp3]
  pnpm generate --demo [--music path/to/track.mp3]
  pnpm generate --render output/your-project
`;

async function main() {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      demo: {type: 'boolean'},
      render: {type: 'string'},
      music: {type: 'string'},
      help: {type: 'boolean', short: 'h'},
    },
  });

  if (values.help) {
    console.log(usage);
    return;
  }
  const topic = positionals.join(' ').trim();
  const modeCount = Number(Boolean(topic)) + Number(Boolean(values.demo)) + Number(Boolean(values.render));
  if (modeCount !== 1 || (values.render && values.music !== undefined)) {
    throw new Error(usage);
  }
  if (values.render) {
    console.log(await renderShort(resolve(values.render)));
    return;
  }

  if (topic) {
    try {
      loadEnvFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Set OPENAI_API_KEY in .env or run with --demo.');
    }
  }
  await run('ffprobe', ['-version']);
  if (values.demo || values.music) await run('ffmpeg', ['-version']);

  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
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
  const project = projectSchema.parse({
    ...(values.demo ? await demoProject(assets, music) : await generateProject(topic, assets)),
    ...(music && {music}),
  });
  await writeFile(join(directory, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  const seconds = project.scenes.reduce((sum, scene) => sum + scene.frames, 0) / FPS;
  console.log(`${project.title} · ${seconds.toFixed(1)} seconds`);
  console.log(await renderShort(directory));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
