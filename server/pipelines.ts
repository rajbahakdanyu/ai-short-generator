import {createHash} from 'node:crypto';
import {copyFile, mkdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {z} from 'zod';
import {writeJson} from '../src/checkpoint.ts';
import type {localSettings} from '../src/local-settings.ts';
import type {LocalStoryboard} from '../src/local-storyboard.ts';
import {buildLocalTopic, planLocalTopic, prepareLocalStoryboard} from '../src/local-topic.ts';
import {run, toWav} from '../src/media.ts';
import {buildPaidShort, type paidBoardSchema} from '../src/paid.ts';
import {projectSchema} from '../src/project.ts';
import type {PaidProviders} from '../src/providers/config.ts';
import {renderShort} from '../src/render.ts';
import {buildStoryboard, readStoryboard} from '../src/storyboard.ts';
import {estimatedSpend, type Job, jobDirectory, saveJob} from './jobs.ts';
import {exportRequest} from './requests.ts';
import {type Upload, uploadPart} from './uploads.ts';

type LocalSettings = z.input<typeof localSettings>;

const reporter = (job: Job) => (detail: string) => {
  job.detail = detail;
};

async function saveProject(job: Job, directory: string, project: unknown) {
  await writeJson(join(directory, 'project.json'), projectSchema.parse(project));
  job.draft = 'project.json';
}

export function providerFingerprint(providers: PaidProviders, video: boolean) {
  const config = {...providers, image: video ? undefined : providers.image};
  const safe = JSON.stringify(config, (key, value) => (key === 'apiKey' ? undefined : value));
  return createHash('sha256').update(safe).digest('hex');
}

export async function renderJob(job: Job, id: string, signal?: AbortSignal) {
  job.phase = 'Rendering video';
  job.detail = 'Encoding MP4';
  job.progress = 0;
  await saveJob(id, job);
  job.file = await renderShort(
    jobDirectory(id),
    (progress) => {
      job.progress = progress;
    },
    signal,
  );
}

export async function runLocalJob(
  topic: string,
  mode: 'direct' | 'plan',
  settings: LocalSettings,
  job: Job,
  id: string,
  signal: AbortSignal,
) {
  const directory = jobDirectory(id);
  if (mode === 'plan') {
    const board = await planLocalTopic(topic, reporter(job), signal, settings);
    await writeJson(join(directory, 'local-storyboard.json'), {...board, settings});
    job.draft = 'local-storyboard.json';
    await saveJob(id, job);
    return;
  }
  await saveProject(job, directory, await buildLocalTopic(topic, directory, reporter(job), signal, settings));
  await renderJob(job, id, signal);
}

export async function prepareLocalJob(
  board: LocalStoryboard,
  settings: LocalSettings,
  job: Job,
  id: string,
  signal: AbortSignal,
) {
  const directory = jobDirectory(id);
  await saveProject(
    job,
    directory,
    await prepareLocalStoryboard(board, directory, reporter(job), signal, settings),
  );
  await renderJob(job, id, signal);
}

async function prepareMusic(
  track: string | undefined,
  directory: string,
  signal?: AbortSignal,
): Promise<'music.wav' | undefined> {
  if (!track) return;
  await toWav(track, join(directory, 'assets', 'music.wav'), undefined, signal);
  return 'music.wav';
}

export async function queuePaid(
  input: {mode: NonNullable<Job['paid']>['mode']; topic?: string; board?: z.infer<typeof paidBoardSchema>},
  providers: PaidProviders,
  job: Job,
  id: string,
  options: {signal: AbortSignal; videoKey?: string},
) {
  const directory = jobDirectory(id);
  await mkdir(join(directory, 'assets'), {recursive: true});
  if (input.mode !== 'plan') {
    await run('ffprobe', ['-version']);
    await run('ffmpeg', ['-version']);
  }
  const {signal, videoKey} = options;
  const soundtrack = join(directory, 'soundtrack.source');
  const soundtrackExists = await stat(soundtrack).then(
    () => true,
    () => false,
  );
  if (soundtrackExists) {
    job.detail = 'Preparing soundtrack';
    await prepareMusic(soundtrack, directory, signal);
    await rm(soundtrack);
  }
  const music = await stat(join(directory, 'assets', 'music.wav')).then(
    () => 'music.wav' as const,
    () => undefined,
  );
  const result = await buildPaidShort(providers, input.topic ?? '', directory, {
    signal,
    videoKey,
    approvedBoard: input.board,
    async beforeRequest(stage) {
      signal.throwIfAborted();
      const usage = {...(job.usage ?? {script: 0, visual: 0, voice: 0})};
      usage[stage]++;
      if (job.estimate && estimatedSpend(usage, job.estimate) > job.estimate.limit + 1e-8)
        throw new Error(
          'Estimated spending limit reached. Raise the limit to submit additional provider requests.',
        );
      job.usage = usage;
      await saveJob(id, job);
      signal.throwIfAborted();
    },
    async report(detail, progress) {
      job.detail = detail;
      job.progress = Math.max(job.progress, progress);
      if (progress >= 0.08) job.draft = 'storyboard.json';
      await saveJob(id, {...job});
    },
  });
  signal.throwIfAborted();
  if (typeof result === 'string') {
    job.draft = 'storyboard.json';
    return;
  }
  await saveProject(job, directory, {...result, music});
  if (input.mode === 'export') await renderJob(job, id, signal);
}

export async function queueExport(form: Upload, job: Job, id: string, signal: AbortSignal) {
  const {title, scenes, musicVolume} = exportRequest.parse(JSON.parse(String(form.fields.get('storyboard'))));
  const directory = jobDirectory(id);
  await mkdir(join(directory, 'assets'), {recursive: true});

  const source = [];
  const prepared = [];
  for (const [index, scene] of scenes.entries()) {
    signal.throwIfAborted();
    job.detail = `Preparing scene ${index + 1} of ${scenes.length}`;
    job.progress = (0.35 * index) / scenes.length;
    const filename = `input-${index + 1}.${scene.kind === 'video' ? 'mp4' : 'image'}`;
    await copyFile(uploadPart(form, `visual-${index}`), join(directory, filename));
    source.push({
      name: scene.name,
      sources: scene.sources,
      narration: scene.narration,
      imagePrompt: scene.imagePrompt,
      kokoroVoice: scene.kokoroVoice,
      [scene.kind]: filename,
    });
    let voice: string | undefined;
    if (form.files.has(`voice-${index}`)) {
      voice = join(directory, `voice-${index + 1}.wav`);
      await toWav(uploadPart(form, `voice-${index}`), voice, 120, signal);
    }
    prepared.push({voice, captions: scene.captions, frames: scene.frames});
  }

  const storyboard = join(directory, 'storyboard.json');
  await writeFile(storyboard, `${JSON.stringify({title, scenes: source}, null, 2)}\n`);
  const music = await prepareMusic(
    form.files.has('music') ? uploadPart(form, 'music') : undefined,
    directory,
    signal,
  );
  const project = await buildStoryboard(
    await readStoryboard(storyboard),
    directory,
    prepared,
    (index) => {
      job.detail = `Processing media for scene ${index + 1} of ${scenes.length}`;
      job.progress = 0.35 + (0.65 * index) / scenes.length;
    },
    signal,
  );
  await saveProject(job, directory, {...project, music, musicVolume});
  await renderJob(job, id, signal);
}
