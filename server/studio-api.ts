import {randomUUID} from 'node:crypto';
import {copyFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Plugin} from 'vite';
import type {z} from 'zod';
import {writeJson} from '../src/checkpoint.ts';
import {errorMessage} from '../src/errors.ts';
import {localSettings} from '../src/local-settings.ts';
import {type LocalStoryboard, localStoryboardSchema} from '../src/local-storyboard.ts';
import {paidProviders, setting} from '../src/providers/config.ts';
import {generateNarration} from '../src/storyboard.ts';
import {isLocalRequest, json, mediaType, readJson, serveMedia} from './http.ts';
import {createJobRunner, type PendingJob} from './job-runner.ts';
import {
  createJob,
  deleteJob,
  idPattern,
  isResumable,
  type Job,
  jobDirectory,
  jobStatus,
  listJobs,
  readDraft,
  readJob,
  readLocalBoard,
  restartJob,
  saveJob,
} from './jobs.ts';
import {
  prepareLocalJob,
  providerFingerprint,
  queueExport,
  queuePaid,
  renderJob,
  runLocalJob,
} from './pipelines.ts';
import {
  localGenerationRequest,
  localMode,
  localPrepareRequest,
  paidRequest,
  voiceRequest,
} from './requests.ts';
import {parseUpload, uploadPart} from './uploads.ts';

const notFound = (res: ServerResponse) => json(res, 404, {error: 'Studio resource not found.'});

function jobRoute(path: string) {
  const match = path.match(/^\/api\/studio\/jobs\/([a-f0-9-]+)(?:\/(.+))?$/);
  return {id: match && idPattern.test(match[1]) ? match[1] : undefined, resource: match?.[2]};
}

async function resumeJob(req: IncomingMessage, id: string): Promise<PendingJob> {
  const job = await readJob(id);
  if (!job || !isResumable(job)) throw new Error('This job has no resumable project.');
  if (job.local?.mode === 'prepare' && job.draft === 'local-storyboard.json') {
    const {settings} = job.local;
    const board = await readLocalBoard(id, settings);
    await restartJob(id, job, 'Preparing scenes');
    return {id, job, task: (signal) => prepareLocalJob(board, settings, job, id, signal)};
  }
  if (!job.paid && job.draft === 'project.json') {
    await restartJob(id, job, 'Rendering video');
    return {id, job, task: (signal) => renderJob(job, id, signal)};
  }
  if (!job.paid) throw new Error('This job has no resumable storyboard.');
  const input = paidRequest.parse(await readJson(req));
  const {mode, video, fingerprint} = job.paid;
  const providers = paidProviders(mode === 'plan', input.selection, video, mode !== 'plan');
  if (providerFingerprint(providers, video) !== fingerprint)
    throw new Error('Select the original providers and models before resuming.');
  const videoKey = video ? (input.videoKey ?? setting('FAL_KEY')) : undefined;
  if (video && !videoKey) throw new Error('Restore the fal API key before resuming.');
  if (input.resumeLimit !== undefined && job.estimate) {
    if (input.resumeLimit < job.estimate.limit)
      throw new Error('The new limit must be at least the original limit.');
    job.estimate.limit = input.resumeLimit;
  }
  await restartJob(id, job, 'Preparing scenes');
  return {id, job, task: (signal) => queuePaid({mode}, providers, job, id, {signal, videoKey})};
}

async function prepareLocal({planId: id, board: approved}: z.infer<typeof localPrepareRequest>) {
  const job = await readJob(id);
  if (
    !job ||
    !['Complete', 'Failed', 'Cancelled'].includes(job.phase) ||
    !job.local ||
    !['plan', 'prepare'].includes(job.local.mode) ||
    job.draft !== 'local-storyboard.json'
  )
    throw new Error('Review a completed local storyboard before preparing scenes.');
  const settings = localSettings.parse(job.local.settings);
  const board = localStoryboardSchema(settings).parse(approved) as LocalStoryboard;
  job.local = {mode: 'prepare', settings};
  job.progress = 0;
  job.detail = 'Preparing approved storyboard';
  await writeJson(join(jobDirectory(id), 'local-storyboard.json'), {...board, settings});
  await restartJob(id, job, 'Preparing scenes');
  return {id, job, task: (signal: AbortSignal) => prepareLocalJob(board, settings, job, id, signal)};
}

async function startLocal(req: IncomingMessage): Promise<PendingJob> {
  const decoded = await readJson(req);
  if (localMode.parse(decoded).mode === 'prepare') return prepareLocal(localPrepareRequest.parse(decoded));
  const {topic, mode, ...settings} = localGenerationRequest.parse(decoded);
  const id = randomUUID();
  const job = await createJob(id);
  job.local = {mode, settings};
  await saveJob(id, job);
  return {id, job, task: (signal) => runLocalJob(topic, mode, settings, job, id, signal)};
}

async function startPaid(req: IncomingMessage): Promise<PendingJob> {
  const form = req.headers['content-type']?.startsWith('multipart/form-data;')
    ? await parseUpload(req)
    : undefined;
  try {
    const input = paidRequest.parse(
      form ? JSON.parse(String(form.fields.get('request'))) : await readJson(req),
    );
    const track = form?.files.has('music') ? uploadPart(form, 'music') : undefined;
    if (track && input.mode === 'plan') throw new Error('A storyboard-only run cannot include a soundtrack.');
    if (input.mode === 'plan' ? !input.topic : !input.board)
      throw new Error('Review a storyboard before preparing paid scenes.');
    const providers = paidProviders(
      input.mode === 'plan',
      input.selection,
      input.video,
      input.mode !== 'plan',
    );
    const videoKey =
      input.video && input.mode !== 'plan' ? (input.videoKey ?? setting('FAL_KEY')) : undefined;
    if (input.video && !videoKey) throw new Error('Enter a fal API key or set FAL_KEY.');
    if (input.estimate) {
      const {script, visual, voice, limit} = input.estimate;
      const estimate =
        input.mode === 'plan'
          ? script
          : (visual + (providers.voice?.provider === 'kokoro' ? 0 : voice)) *
            (input.board?.scenes.length ?? 0);
      if (estimate > limit + 1e-8) throw new Error('Estimated provider charges exceed your limit.');
    }
    const id = randomUUID();
    const job = await createJob(id, {
      mode: input.mode,
      video: input.video,
      fingerprint: providerFingerprint(providers, input.video),
    });
    job.estimate = input.estimate;
    job.usage = {script: 0, visual: 0, voice: 0};
    await saveJob(id, job);
    if (track) await copyFile(track, join(jobDirectory(id), 'soundtrack.source'));
    if (input.board) {
      await writeJson(join(jobDirectory(id), 'storyboard.json'), input.board);
      job.draft = 'storyboard.json';
      await saveJob(id, job);
    }
    return {
      id,
      job,
      task: (signal) =>
        queuePaid(input, providers, job, id, {signal, videoKey}).finally(() => form?.cleanup()),
    };
  } catch (error) {
    await form?.cleanup();
    throw error;
  }
}

async function startExport(req: IncomingMessage): Promise<PendingJob> {
  const form = await parseUpload(req);
  try {
    const id = randomUUID();
    const job = await createJob(id);
    return {id, job, task: (signal) => queueExport(form, job, id, signal).finally(form.cleanup)};
  } catch (error) {
    await form.cleanup();
    throw error;
  }
}

async function previewVoice(req: IncomingMessage, res: ServerResponse) {
  const {narration, kokoroVoice} = voiceRequest.parse(await readJson(req));
  const directory = await mkdtemp(join(tmpdir(), 'short-studio-'));
  try {
    await generateNarration([{index: 1, narration, kokoroVoice}], directory, directory);
    const audio = await readFile(join(directory, 'scene-1.wav'));
    res.writeHead(200, {'Content-Type': 'audio/wav', 'Cache-Control': 'no-store'});
    res.end(audio);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

async function sendJobResource(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  job: Job,
  resource: string | undefined,
) {
  if (!resource) return json(res, 200, jobStatus(job));
  if (resource === 'video' && job.phase === 'Complete' && job.file)
    return serveMedia(req, res, job.file, 'video/mp4');
  if (!job.draft) return notFound(res);
  if (resource === 'draft') return json(res, 200, await readDraft(id, job.draft, job.local));
  const asset = resource.match(/^assets\/((?:scene-\d+\.(?:jpg|mp4|wav))|music\.wav)$/);
  if (!asset) return notFound(res);
  return serveMedia(req, res, join(jobDirectory(id), 'assets', asset[1]), mediaType(asset[1]));
}

export function studioApi(): Plugin {
  const runner = createJobRunner();
  const busy = (res: ServerResponse) => json(res, 409, {error: 'Another generation is running.'});

  async function launch(res: ServerResponse, prepare: () => Promise<PendingJob>) {
    if (!runner.claim()) return busy(res);
    let pending: PendingJob;
    try {
      pending = await prepare();
    } catch (error) {
      runner.release();
      throw error;
    }
    json(res, 202, {id: runner.start(pending)});
  }

  async function voice(req: IncomingMessage, res: ServerResponse) {
    if (!runner.claim()) return busy(res);
    try {
      await previewVoice(req, res);
    } finally {
      runner.release();
    }
  }

  async function removeJob(res: ServerResponse, id: string) {
    if (runner.activeId === id) return json(res, 409, {error: 'Stop the generation before deleting it.'});
    if (!(await readJob(id))) return json(res, 404, {error: 'Job not found.'});
    await deleteJob(id);
    json(res, 200, {});
  }

  async function route(req: IncomingMessage, res: ServerResponse, path: string) {
    const {id, resource} = jobRoute(path);
    if (req.method === 'GET') {
      if (path === '/api/studio/jobs') return json(res, 200, await listJobs(runner.activeId));
      const job = id && (runner.activeJob(id) ?? (await readJob(id)));
      return id && job ? sendJobResource(req, res, id, job, resource) : notFound(res);
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') return notFound(res);
    if (req.headers['x-short-studio'] !== '1')
      return json(res, 403, {error: 'Studio request header missing.'});
    if (req.method === 'DELETE')
      return id && !resource ? removeJob(res, id) : json(res, 404, {error: 'Job not found.'});
    if (id && resource === 'cancel' && runner.cancel(id)) return json(res, 202, {});
    if (id && resource === 'resume') return launch(res, () => resumeJob(req, id));
    if (path === '/api/studio/voice') return voice(req, res);
    if (path === '/api/studio/local') return launch(res, () => startLocal(req));
    if (path === '/api/studio/paid') return launch(res, () => startPaid(req));
    if (path === '/api/studio/export') return launch(res, () => startExport(req));
    return notFound(res);
  }

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/studio/')) return next();
    if (!isLocalRequest(req)) return json(res, 403, {error: 'Open Short Studio using its local address.'});
    try {
      await route(req, res, path);
    } catch (error) {
      if (!res.headersSent) return json(res, 400, {error: errorMessage(error)});
      res.end();
    }
  };

  return {
    name: 'short-studio-api',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}
