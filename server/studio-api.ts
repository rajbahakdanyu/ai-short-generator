import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {Plugin} from 'vite';
import {z} from 'zod';
import {readOptional, writeJson} from '../src/checkpoint.ts';
import {run, toWav} from '../src/media.ts';
import {buildPaidShort, paidBoardSchema} from '../src/paid.ts';
import {
  kokoroVoiceSchema,
  maxScenes,
  projectSchema,
  projectTitle,
  sceneCaptions,
  sceneFrames,
  sceneMetadata,
} from '../src/project.ts';
import {paidProviders, setting} from '../src/providers/config.ts';
import {renderShort} from '../src/render.ts';
import {buildStoryboard, generateNarration, readStoryboard} from '../src/storyboard.ts';

import {
  createJob,
  deleteJob,
  estimatedSpend,
  idPattern,
  type Job,
  jobDirectory,
  listJobs,
  readJob,
  saveJob,
} from './jobs.ts';
import {parseUpload, type Upload} from './uploads.ts';

const requestSchema = z.object({
  title: projectTitle,
  musicVolume: z.number().min(0).max(1).optional(),
  scenes: z
    .array(
      sceneMetadata.extend({
        kind: z.enum(['image', 'video']),
        captions: sceneCaptions.optional(),
        frames: sceneFrames.optional(),
      }),
    )
    .min(1)
    .max(maxScenes),
});
const providerPick = z.object({
  provider: z.string().trim().min(1).max(50).optional(),
  model: z.string().trim().min(1).max(300).optional(),
  apiKey: z.string().trim().min(1).max(1500).optional(),
  baseUrl: z.string().trim().min(1).max(1000).optional(),
});
const paidRequest = z.object({
  topic: z.string().trim().max(4000).default(''),
  board: paidBoardSchema.optional(),
  video: z.boolean().default(false),
  videoKey: z.string().trim().min(1).max(1500).optional(),
  resumeLimit: z.number().nonnegative().optional(),
  estimate: z
    .object({
      script: z.number().nonnegative(),
      visual: z.number().nonnegative(),
      voice: z.number().nonnegative(),
      limit: z.number().nonnegative(),
    })
    .optional(),
  mode: z.enum(['plan', 'prepare', 'export']),
  selection: z
    .object({
      script: providerPick.optional(),
      image: providerPick
        .extend({
          size: z.string().trim().min(1).max(50).optional(),
          aspectRatio: z.string().trim().min(1).max(30).optional(),
          options: z.string().trim().min(1).max(5000).optional(),
        })
        .optional(),
      voice: providerPick
        .extend({
          voice: z.string().trim().min(1).max(200).optional(),
          format: z.enum(['wav', 'mp3', 'flac', 'aac', 'opus', 'pcm']).optional(),
        })
        .optional(),
    })
    .optional(),
});

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
}

function uploadPart(form: Upload, key: string) {
  const path = form.files.get(key);
  if (!path) throw new Error(`Missing file for ${key}.`);
  return path;
}

async function serveMedia(req: IncomingMessage, res: ServerResponse, path: string, contentType: string) {
  const {size} = await stat(path);
  const headers = {'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    res.writeHead(200, {...headers, 'Content-Length': size});
    await pipeline(createReadStream(path), res);
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (start > end || start >= size) {
    res.writeHead(416, {'Content-Range': `bytes */${size}`});
    res.end();
    return;
  }
  res.writeHead(206, {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': end - start + 1,
  });
  await pipeline(createReadStream(path, {start, end}), res);
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > 160_000) throw new Error('This studio request is too long.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}

async function renderJob(job: Job, id: string, signal?: AbortSignal) {
  const directory = jobDirectory(id);
  job.phase = 'Rendering video';
  job.detail = 'Encoding MP4';
  job.progress = 0;
  await saveJob(id, job);
  job.file = await renderShort(
    directory,
    (progress) => {
      job.progress = progress;
    },
    signal,
  );
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

async function queuePaid(
  input: {mode: NonNullable<Job['paid']>['mode']; topic?: string; board?: z.infer<typeof paidBoardSchema>},
  providers: ReturnType<typeof paidProviders>,
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
  const project = projectSchema.parse({...result, music});
  await writeJson(join(directory, 'project.json'), project);
  job.draft = 'project.json';
  if (input.mode === 'export') await renderJob(job, id, signal);
}

async function queueExport(form: Upload, job: Job, id: string, signal: AbortSignal) {
  const {title, scenes, musicVolume} = requestSchema.parse(JSON.parse(String(form.fields.get('storyboard'))));
  const directory = jobDirectory(id);
  const assets = join(directory, 'assets');
  await mkdir(assets, {recursive: true});

  const source = [];
  const prepared = [];
  for (const [index, scene] of scenes.entries()) {
    signal.throwIfAborted();
    job.detail = `Preparing scene ${index + 1} of ${scenes.length}`;
    job.progress = (0.35 * index) / scenes.length;
    const visual = uploadPart(form, `visual-${index}`);
    const filename = `input-${index + 1}.${scene.kind === 'video' ? 'mp4' : 'image'}`;
    await copyFile(visual, join(directory, filename));
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
      const recording = uploadPart(form, `voice-${index}`);
      voice = join(directory, `voice-${index + 1}.wav`);
      await toWav(recording, voice, 120, signal);
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
  const project = projectSchema.parse({
    ...(await buildStoryboard(
      await readStoryboard(storyboard),
      directory,
      prepared,
      (index) => {
        job.detail = `Processing media for scene ${index + 1} of ${scenes.length}`;
        job.progress = 0.35 + (0.65 * index) / scenes.length;
      },
      signal,
    )),
    music,
    musicVolume,
  });
  await writeJson(join(directory, 'project.json'), project);
  job.draft = 'project.json';
  await renderJob(job, id, signal);
}

export function studioApi(): Plugin {
  let active: {id: string; job: Job; controller: AbortController} | undefined;
  let rendering = false;
  let narrating = false;

  function startJob(id: string, job: Job, task: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    active = {id, job, controller};
    void task(controller.signal)
      .then(() => {
        controller.signal.throwIfAborted();
        job.phase = 'Complete';
        job.progress = 1;
      })
      .catch((error: unknown) => {
        job.phase = controller.signal.aborted ? 'Cancelled' : 'Failed';
        job.error = controller.signal.aborted
          ? 'Generation stopped. Provider calls already submitted may still be charged.'
          : error instanceof Error
            ? error.message
            : String(error);
      })
      .finally(async () => {
        try {
          await saveJob(id, job);
        } finally {
          active = undefined;
          rendering = false;
        }
      })
      .catch((error) => console.error('Could not save Studio job status', error));
    return id;
  }

  function fingerprint(providers: ReturnType<typeof paidProviders>, video: boolean) {
    const config = {...providers, image: video ? undefined : providers.image};
    const safe = JSON.stringify(config, (key, value) => (key === 'apiKey' ? undefined : value));
    return createHash('sha256').update(safe).digest('hex');
  }

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/studio/')) return next();
    const host = req.headers.host ?? '';
    if (
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      return json(res, 403, {error: 'Open Short Studio using its local address.'});
    }

    try {
      const match = path.match(/^\/api\/studio\/jobs\/([a-f0-9-]+)(?:\/(.+))?$/);
      const id = match && idPattern.test(match[1]) ? match[1] : undefined;
      const resource = match?.[2];
      if (req.method === 'GET' && path === '/api/studio/jobs')
        return json(res, 200, await listJobs(active?.id));
      if (req.method === 'POST' || req.method === 'DELETE') {
        if (req.headers['x-short-studio'] !== '1')
          return json(res, 403, {error: 'Studio request header missing.'});
        if (id && resource === 'cancel' && req.method === 'POST' && active?.id === id) {
          active.controller.abort();
          return json(res, 202, {});
        }
        if (id && req.method === 'DELETE' && !resource) {
          if (active?.id === id) return json(res, 409, {error: 'Stop the generation before deleting it.'});
          if (!(await readJob(id))) return json(res, 404, {error: 'Job not found.'});
          await deleteJob(id);
          return json(res, 200, {});
        }
        if (id && resource === 'resume' && req.method === 'POST') {
          if (rendering || narrating) return json(res, 409, {error: 'Another generation is running.'});
          rendering = true;
          try {
            const job = await readJob(id);
            if (!job?.draft || !['Failed', 'Cancelled'].includes(job.phase))
              throw new Error('This job has no resumable project.');
            if (!job.paid && job.draft === 'project.json') {
              job.error = undefined;
              job.startedAt = Date.now();
              job.phase = 'Rendering video';
              await saveJob(id, job);
              return json(res, 202, {
                id: startJob(id, job, (signal) => renderJob(job, id, signal)),
              });
            }
            if (!job.paid) throw new Error('This job has no resumable storyboard.');
            const input = paidRequest.parse(await readJson(req));
            const {mode, video} = job.paid;
            const providers = paidProviders(mode === 'plan', input.selection, video, mode !== 'plan');
            if (fingerprint(providers, video) !== job.paid.fingerprint)
              throw new Error('Select the original providers and models before resuming.');
            const videoKey = video ? (input.videoKey ?? setting('FAL_KEY')) : undefined;
            if (video && !videoKey) throw new Error('Restore the fal API key before resuming.');
            if (input.resumeLimit !== undefined && job.estimate) {
              if (input.resumeLimit < job.estimate.limit)
                throw new Error('The new limit must be at least the original limit.');
              job.estimate.limit = input.resumeLimit;
            }
            job.phase = 'Preparing scenes';
            job.error = undefined;
            job.startedAt = Date.now();
            await saveJob(id, job);
            return json(res, 202, {
              id: startJob(id, job, (signal) => queuePaid({mode}, providers, job, id, {signal, videoKey})),
            });
          } catch (error) {
            rendering = false;
            throw error;
          }
        }
        if (req.method === 'DELETE') return json(res, 404, {error: 'Job not found.'});
        if (path === '/api/studio/voice') {
          if (narrating || rendering) return json(res, 409, {error: 'Another generation is running.'});
          narrating = true;
          let directory: string | undefined;
          try {
            const {narration, kokoroVoice} = z
              .object({
                narration: z.string().trim().min(1).max(4000),
                kokoroVoice: kokoroVoiceSchema.optional(),
              })
              .parse(await readJson(req));
            directory = await mkdtemp(join(tmpdir(), 'short-studio-'));
            await generateNarration([{index: 1, narration, kokoroVoice}], directory, directory);
            const audio = await readFile(join(directory, 'scene-1.wav'));
            res.writeHead(200, {'Content-Type': 'audio/wav', 'Cache-Control': 'no-store'});
            return res.end(audio);
          } finally {
            narrating = false;
            if (directory) await rm(directory, {recursive: true, force: true});
          }
        }
        if (path === '/api/studio/export' || path === '/api/studio/paid') {
          if (rendering || narrating) return json(res, 409, {error: 'Another generation is running.'});
          rendering = true;
          let upload: Upload | undefined;
          try {
            if (path.endsWith('/paid')) {
              if (req.headers['content-type']?.startsWith('multipart/form-data;'))
                upload = await parseUpload(req);
              const form = upload;
              const decoded: unknown = form
                ? JSON.parse(String(form.fields.get('request')))
                : await readJson(req);
              const input = paidRequest.parse(decoded);
              const track = form?.files.has('music') ? uploadPart(form, 'music') : undefined;
              if (track && input.mode === 'plan')
                throw new Error('A storyboard-only run cannot include a soundtrack.');
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
                fingerprint: fingerprint(providers, input.video),
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
              return json(res, 202, {
                id: startJob(id, job, (signal) =>
                  queuePaid(input, providers, job, id, {signal, videoKey}).finally(() => form?.cleanup()),
                ),
              });
            }
            const form = await parseUpload(req);
            upload = form;
            const id = randomUUID();
            const job = await createJob(id);
            return json(res, 202, {
              id: startJob(id, job, (signal) => queueExport(form, job, id, signal).finally(form.cleanup)),
            });
          } catch (error) {
            rendering = false;
            await upload?.cleanup();
            throw error;
          }
        }
      }

      const job = id ? (active?.id === id ? active.job : await readJob(id)) : undefined;
      if (req.method === 'GET' && id && job) {
        if (!resource) {
          return json(res, 200, {
            phase: job.phase,
            progress: job.progress,
            error: job.error,
            detail: job.detail,
            startedAt: job.startedAt,
            usage: job.usage,
            spendingLimit: job.estimate?.limit,
            estimatedSpend: job.usage && job.estimate ? estimatedSpend(job.usage, job.estimate) : undefined,
            resumable: !!job.draft && (job.phase === 'Failed' || job.phase === 'Cancelled'),
            resumeNeedsProviders: !!job.paid,
            hasVideo: !!job.file,
            hasDraft: !!job.draft,
          });
        }
        if (job.phase === 'Complete' && resource === 'video' && job.file)
          return await serveMedia(req, res, job.file, 'video/mp4');
        if (resource === 'draft' && job.draft) {
          const manifest = JSON.parse(await readFile(join(jobDirectory(id), job.draft), 'utf8')) as unknown;
          if (job.draft === 'project.json') return json(res, 200, {kind: 'project', manifest});
          const board = paidBoardSchema.parse(manifest);
          const scenes = await Promise.all(
            board.scenes.map(async (scene, index) => {
              const filename = `scene-${index + 1}`;
              const prepared = await readOptional(join(jobDirectory(id), `${filename}.json`));
              return prepared ? JSON.parse(prepared.toString()) : scene;
            }),
          );
          return json(res, 200, {kind: 'storyboard', manifest: {...board, scenes}});
        }
        const asset = resource.match(/^assets\/((?:scene-\d+\.(?:jpg|mp4|wav))|music\.wav)$/);
        if (asset && job.draft) {
          const filename = asset[1];
          const mime = filename.endsWith('.jpg')
            ? 'image/jpeg'
            : filename.endsWith('.mp4')
              ? 'video/mp4'
              : 'audio/wav';
          return await serveMedia(req, res, join(jobDirectory(id), 'assets', filename), mime);
        }
      }
      return json(res, 404, {error: 'Studio resource not found.'});
    } catch (error) {
      if (!res.headersSent)
        return json(res, 400, {error: error instanceof Error ? error.message : String(error)});
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
