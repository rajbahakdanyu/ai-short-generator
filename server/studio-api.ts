import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import type {Plugin} from 'vite';
import {z} from 'zod';
import {toWav} from '../src/media.ts';
import {captionSchema, projectSchema} from '../src/project.ts';
import {renderShort} from '../src/render.ts';
import {buildStoryboard, generateNarration, readStoryboard} from '../src/storyboard.ts';

const maxUpload = 256 * 1024 * 1024;
const requestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scenes: z
    .array(
      z.object({
        narration: z.string().trim().min(1).max(4000),
        kind: z.enum(['image', 'video']),
        captions: z.array(captionSchema).optional(),
      }),
    )
    .min(1)
    .max(100),
});
type Job = {
  phase: 'Preparing scenes' | 'Rendering video' | 'Complete' | 'Failed';
  progress: number;
  file?: string;
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

async function serveVideo(req: IncomingMessage, res: ServerResponse, path: string) {
  const {size} = await stat(path);
  const headers = {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
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

async function queueExport(form: FormData, job: Job, id: string) {
  const {title, scenes} = requestSchema.parse(JSON.parse(String(form.get('storyboard'))));
  const directory = resolve('output', `studio-${id}`);
  const assets = join(directory, 'assets');
  await mkdir(assets, {recursive: true});

  const source = [];
  const prepared = [];
  for (const [index, scene] of scenes.entries()) {
    const visual = uploadPart(form, `visual-${index}`);
    const filename = `input-${index + 1}.${scene.kind === 'video' ? 'mp4' : 'image'}`;
    await writeFile(join(directory, filename), Buffer.from(await visual.arrayBuffer()));
    source.push({narration: scene.narration, [scene.kind]: filename});
    let voice: string | undefined;
    if (form.has(`voice-${index}`)) {
      const recording = uploadPart(form, `voice-${index}`);
      const input = join(directory, `voice-${index + 1}.source`);
      voice = join(directory, `voice-${index + 1}.wav`);
      await writeFile(input, Buffer.from(await recording.arrayBuffer()));
      await toWav(input, voice);
      await rm(input);
    }
    prepared.push({voice, captions: scene.captions});
  }

  const storyboard = join(directory, 'storyboard.json');
  await writeFile(storyboard, `${JSON.stringify({title, scenes: source}, null, 2)}\n`);
  let music: 'music.wav' | undefined;
  if (form.has('music')) {
    const track = uploadPart(form, 'music');
    const input = join(directory, 'music.source');
    await writeFile(input, Buffer.from(await track.arrayBuffer()));
    music = 'music.wav';
    await toWav(input, join(assets, music));
    await rm(input);
  }
  const project = projectSchema.parse({
    ...(await buildStoryboard(await readStoryboard(storyboard), directory, prepared)),
    music,
  });
  await writeFile(join(directory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  job.phase = 'Rendering video';
  job.file = await renderShort(directory, (progress) => {
    job.progress = progress;
  });
  job.progress = 1;
  job.phase = 'Complete';
}

export function studioApi(): Plugin {
  const jobs = new Map<string, Job>();
  let rendering = false;
  let narrating = false;

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
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req.iterator({destroyOnReturn: false})) {
              size += chunk.length;
              if (size > 20_000) throw new Error('Narration is too long.');
              chunks.push(chunk);
            }
            const {narration} = z
              .object({narration: z.string().trim().min(1).max(4000)})
              .parse(JSON.parse(Buffer.concat(chunks).toString()));
            directory = await mkdtemp(join(tmpdir(), 'short-studio-'));
            await generateNarration([{index: 1, narration}], directory, directory);
            const audio = await readFile(join(directory, 'scene-1.wav'));
            res.writeHead(200, {'Content-Type': 'audio/wav', 'Cache-Control': 'no-store'});
            return res.end(audio);
          } finally {
            narrating = false;
            if (directory) await rm(directory, {recursive: true, force: true});
          }
        }
        if (path === '/api/studio/export') {
          if (rendering || narrating) return json(res, 409, {error: 'Another generation is running.'});
          rendering = true;
          try {
            const form = await parseUpload(req);
            const id = randomUUID();
            const job: Job = {phase: 'Preparing scenes', progress: 0};
            jobs.set(id, job);
            void queueExport(form, job, id)
              .catch((error: unknown) => {
                job.phase = 'Failed';
                job.error = error instanceof Error ? error.message : String(error);
              })
              .finally(() => {
                rendering = false;
              });
            return json(res, 202, {id});
          } catch (error) {
            rendering = false;
            throw error;
          }
        }
      }

      const match = path.match(/^\/api\/studio\/jobs\/([a-f0-9-]+)(\/video)?$/);
      const job = match && jobs.get(match[1]);
      if (req.method === 'GET' && match && job) {
        if (match[2] && job.file) return await serveVideo(req, res, job.file);
        if (!match[2]) return json(res, 200, {phase: job.phase, progress: job.progress, error: job.error});
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
