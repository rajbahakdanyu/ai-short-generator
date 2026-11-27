import {access, mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {demoProject} from './demo.ts';
import {parseKokoroVoice} from './kokoro-voices.ts';
import {buildLocalTopic} from './local-topic.ts';
import {run, toWav} from './media.ts';
import {buildPaidShort} from './paid.ts';
import {FPS, projectSchema} from './project.ts';
import {paidProviders} from './providers/config.ts';
import {renderShort} from './render.ts';
import {buildStoryboard, readStoryboard} from './storyboard.ts';

const usage = `Usage
  pnpm generate --local-topic "Your topic" [--scenes 1-6] [--style "Watercolour"] [--kokoro-voice ID] [--prepare-only]
  pnpm generate --storyboard path/to/storyboard.json [--music path/to/track.mp3] [--prepare-only]
  pnpm generate --paid-topic "Your topic" [--music path/to/track.mp3] [--prepare-only]
  pnpm generate --paid-topic "Your topic" --plan-only
  pnpm generate --resume-paid output/your-project [--prepare-only]
  pnpm generate --demo [--music path/to/track.mp3] [--prepare-only]
  pnpm generate --render output/your-project

--kokoro-voice ID overrides the voice for local storyboard narration or paid mode with VOICE_PROVIDER=kokoro.
`;

async function main() {
  const {values} = parseArgs({
    options: {
      scenes: {type: 'string'},
      style: {type: 'string'},
      demo: {type: 'boolean'},
      storyboard: {type: 'string'},
      'local-topic': {type: 'string'},
      'paid-topic': {type: 'string'},
      'resume-paid': {type: 'string'},
      'plan-only': {type: 'boolean'},
      'kokoro-voice': {type: 'string'},
      'prepare-only': {type: 'boolean'},
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
  const local = values['local-topic']?.trim();
  const resume = values['resume-paid'] && resolve(values['resume-paid']);
  const planOnly = values['plan-only'] ?? false;
  const modes = [values.storyboard, values.demo, values.render, topic, local, resume].filter(Boolean);
  if (
    modes.length !== 1 ||
    (!local && (values.scenes !== undefined || values.style !== undefined)) ||
    (planOnly && !topic) ||
    (values['prepare-only'] && (planOnly || values.render)) ||
    ((values.render || planOnly || resume) && values.music !== undefined)
  ) {
    throw new Error(usage);
  }
  const voice = values['kokoro-voice'] !== undefined ? parseKokoroVoice(values['kokoro-voice']) : undefined;
  if (voice && (values.render || values.demo || planOnly))
    throw new Error('--kokoro-voice requires narration generation.');
  if (values.render) {
    console.log(await renderShort(resolve(values.render)));
    return;
  }

  const source = values.storyboard ? await readStoryboard(resolve(values.storyboard)) : undefined;
  const board =
    source && voice
      ? {...source, scenes: source.scenes.map((scene) => ({...scene, kokoroVoice: voice}))}
      : source;
  const provider =
    topic || resume ? paidProviders(planOnly, voice ? {voice: {voice}} : undefined) : undefined;
  if (voice && provider && provider.voice?.provider !== 'kokoro') {
    throw new Error('--kokoro-voice requires VOICE_PROVIDER=kokoro in paid mode.');
  }
  if (!planOnly) {
    await run('ffprobe', ['-version']);
    await run('ffmpeg', ['-version']);
  }

  const slug = (board?.title ?? topic ?? local)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  const output = resolve('output');
  await mkdir(output, {recursive: true});
  const directory = resume || (await mkdtemp(join(output, `${slug || (values.demo ? 'demo' : 'short')}-`)));
  if (resume) {
    await access(join(directory, 'storyboard.json')).catch(() => {
      throw new Error('Resume requires an existing paid storyboard.');
    });
  }
  const assets = join(directory, 'assets');
  await mkdir(assets, {recursive: true});
  console.log(`Project directory ${directory}`);
  let music: 'music.wav' | undefined;
  if (resume)
    music = await access(join(assets, 'music.wav')).then(
      () => 'music.wav' as const,
      () => undefined,
    );
  if (values.music !== undefined) {
    music = 'music.wav';
    await toWav(resolve(values.music), join(assets, music));
  }
  const result = local
    ? await buildLocalTopic(local, directory, console.log, undefined, {
        voice,
        scenes: values.scenes === undefined ? undefined : Number(values.scenes),
        style: values.style,
      })
    : provider
      ? await buildPaidShort(provider, topic ?? '', directory, {
          async report(detail) {
            console.log(detail);
          },
        })
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
  if (values['prepare-only']) {
    console.log(`Project ready at ${join(directory, 'project.json')}`);
    return;
  }
  console.log(await renderShort(directory));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
