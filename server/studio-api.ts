import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import type {Plugin} from 'vite';
import {z} from 'zod';
import {run, toWav} from '../src/media.ts';
import {buildPaidShort} from '../src/paid.ts';
import {captionSchema, kokoroVoiceSchema, projectSchema} from '../src/project.ts';
import {paidProviders} from '../src/providers/config.ts';
import {renderShort} from '../src/render.ts';
import {buildStoryboard, generateNarration, readStoryboard} from '../src/storyboard.ts';

const maxUpload = 256 * 1024 * 1024;
const requestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scenes: z
    .array(
      z.object({
        narration: z.string().trim().min(1).max(4000),
        kokoroVoice: kokoroVoiceSchema.optional(),
        kind: z.enum(['image', 'video']),
        captions: z.array(captionSchema).optional(),
        frames: z.number().int().positive().optional(),
        imagePrompt: z.string().trim().min(1).optional(),
      }),
    )
    .min(1)
    .max(100),
});
const providerPick = z.object({
  provider: z.string().trim().min(1).max(50).optional(),
  model: z.string().trim().min(1).max(300).optional(),
});
const paidRequest = z.object({
  topic: z.string().trim().min(1).max(4000),
  mode: z.enum(['plan', 'prepare', 'export']),
  selection: z
    .object({
      script: providerPick.optional(),
      image: providerPick.optional(),
      voice: providerPick.extend({voice: z.string().trim().min(1).max(200).optional()}).optional(),
    })
    .optional(),
});

type Job = {
  phase: 'Preparing scenes' | 'Rendering video' | 'Complete' | 'Failed';
  progress: number;
  file?: string;
  draft?: 'project.json' | 'storyboard.json';
  error?: string;
};

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
}

function uploadPart(form: FormData, key: string) {
  const entry = form.get(key);
  if (!(entry instanceof File) || !entry.size) throw new Error(`Missing file for ${key}.`);
  return entry;
}

async function parseUpload(req: IncomingMessage) {
  const type = req.headers['content-type'];
  if (!type?.startsWith('multipart/form-data;')) throw new Error('Expected a multipart export.');
  if (Number(req.headers['content-length']) > maxUpload)
    throw new Error('Exports support up to 256 MB of uploaded media.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > maxUpload) throw new Error('Exports support up to 256 MB of uploaded media.');
    chunks.push(chunk);
  }
  return new Response(Buffer.concat(chunks, size), {headers: {'Content-Type': type}}).formData();
}

async function serveMedia(req: IncomingMessage, res: ServerResponse, path: string, contentType: string) {
  const {size} = await stat(path);
  const headers = {'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    res.writeHead(200, {...headers, 'Content-Length': size});
    createReadStream(path).pipe(res);
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
  createReadStream(path, {start, end}).pipe(res);
}

const jobDirectory = (id: string) => resolve('output', `studio-${id}`);

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > 24_000) throw new Error('This studio request is too long.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}

async function renderJob(job: Job, directory: string) {
  job.phase = 'Rendering video';
  job.file = await renderShort(directory, (progress) => {
    job.progress = progress;
  });
}

async function prepareMusic(track: File | undefined, directory: string): Promise<'music.wav' | undefined> {
  if (!track) return;
  const input = join(directory, 'music.source');
  await writeFile(input, Buffer.from(await track.arrayBuffer()));
  try {
    await toWav(input, join(directory, 'assets', 'music.wav'));
    return 'music.wav';
  } finally {
    await rm(input, {force: true});
  }
}

async function queuePaid(
  input: z.infer<typeof paidRequest>,
  providers: ReturnType<typeof paidProviders>,
  job: Job,
  id: string,
  track?: File,
) {
  const directory = jobDirectory(id);
  await mkdir(join(directory, 'assets'), {recursive: true});
  if (input.mode !== 'plan') {
    await run('ffprobe', ['-version']);
    await run('ffmpeg', ['-version']);
  }
  const music = await prepareMusic(track, directory);
  const result = await buildPaidShort(providers, input.topic, directory);
  if (typeof result === 'string') {
    job.draft = 'storyboard.json';
    return;
  }
  const project = projectSchema.parse({...result, music});
  await writeFile(join(directory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  job.draft = 'project.json';
  if (input.mode === 'export') await renderJob(job, directory);
}

async function queueExport(form: FormData, job: Job, id: string) {
  const {title, scenes} = requestSchema.parse(JSON.parse(String(form.get('storyboard'))));
  const directory = jobDirectory(id);
  const assets = join(directory, 'assets');
  await mkdir(assets, {recursive: true});

  const source = [];
  const prepared = [];
  for (const [index, scene] of scenes.entries()) {
    const visual = uploadPart(form, `visual-${index}`);
    const filename = `input-${index + 1}.${scene.kind === 'video' ? 'mp4' : 'image'}`;
    await writeFile(join(directory, filename), Buffer.from(await visual.arrayBuffer()));
    source.push({
      narration: scene.narration,
      imagePrompt: scene.imagePrompt,
      kokoroVoice: scene.kokoroVoice,
      [scene.kind]: filename,
    });
    let voice: string | undefined;
    if (form.has(`voice-${index}`)) {
      const recording = uploadPart(form, `voice-${index}`);
      const input = join(directory, `voice-${index + 1}.source`);
      voice = join(directory, `voice-${index + 1}.wav`);
      await writeFile(input, Buffer.from(await recording.arrayBuffer()));
      await toWav(input, voice);
      await rm(input);
    }
    prepared.push({voice, captions: scene.captions, frames: voice ? scene.frames : undefined});
  }

  const storyboard = join(directory, 'storyboard.json');
  await writeFile(storyboard, `${JSON.stringify({title, scenes: source}, null, 2)}\n`);
  const music = await prepareMusic(form.has('music') ? uploadPart(form, 'music') : undefined, directory);
  const project = projectSchema.parse({
    ...(await buildStoryboard(await readStoryboard(storyboard), directory, prepared)),
    music,
  });
  await writeFile(join(directory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  await renderJob(job, directory);
}

export function studioApi(): Plugin {
  const jobs = new Map<string, Job>();
  let rendering = false;
  let narrating = false;

  function startJob(task: (job: Job, id: string) => Promise<void>) {
    const id = randomUUID();
    const job: Job = {phase: 'Preparing scenes', progress: 0};
    jobs.set(id, job);
    void task(job, id)
      .then(() => {
        job.phase = 'Complete';
        job.progress = 1;
      })
      .catch((error: unknown) => {
        job.phase = 'Failed';
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        rendering = false;
      });
    return id;
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
      if (req.method === 'POST') {
        if (req.headers['x-short-studio'] !== '1')
          return json(res, 403, {error: 'Studio request header missing.'});
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
          try {
            if (path.endsWith('/paid')) {
              const form = req.headers['content-type']?.startsWith('multipart/form-data;')
                ? await parseUpload(req)
                : undefined;
              const decoded: unknown = form ? JSON.parse(String(form.get('request'))) : await readJson(req);
              const input = paidRequest.parse(decoded);
              const track = form?.has('music') ? uploadPart(form, 'music') : undefined;
              if (track && input.mode === 'plan')
                throw new Error('A storyboard-only run cannot include a soundtrack.');
              const providers = paidProviders(input.mode === 'plan', input.selection);
              return json(res, 202, {id: startJob((job, id) => queuePaid(input, providers, job, id, track))});
            }
            const form = await parseUpload(req);
            return json(res, 202, {id: startJob((job, id) => queueExport(form, job, id))});
          } catch (error) {
            rendering = false;
            throw error;
          }
        }
      }

      const match = path.match(/^\/api\/studio\/jobs\/([a-f0-9-]+)(?:\/(.+))?$/);
      const job = match && jobs.get(match[1]);
      if (req.method === 'GET' && match && job) {
        const [, id, resource] = match;
        if (!resource) {
          return json(res, 200, {
            phase: job.phase,
            progress: job.progress,
            error: job.error,
            hasVideo: !!job.file,
            hasDraft: !!job.draft,
          });
        }
        if (job.phase === 'Complete' && resource === 'video' && job.file)
          return await serveMedia(req, res, job.file, 'video/mp4');
        if (resource === 'draft' && job.draft) {
          const manifest = JSON.parse(await readFile(join(jobDirectory(id), job.draft), 'utf8')) as unknown;
          return json(res, 200, {kind: job.draft === 'project.json' ? 'project' : 'storyboard', manifest});
        }
        const asset = resource.match(/^assets\/((?:scene-\d+\.(?:jpg|mp4|wav))|music\.wav)$/);
        if (asset && job.draft === 'project.json') {
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
