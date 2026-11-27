import {createHash, randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {cp, mkdtemp, readFile, rename, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal, renderMedia, selectComposition} from '@remotion/renderer';
import type {Diagram} from './diagram.tsx';
import {projectSchema} from './project.ts';

const compositionSources = [
  'diagram.tsx',
  'video.tsx',
  'composition.tsx',
  'project.ts',
  'timing.ts',
  'kokoro-voices.ts',
];
let template: {signature: string; bundle: Promise<string>} | undefined;

async function projectBundle(assets: string) {
  const sources = await Promise.all(
    compositionSources.map((file) => readFile(new URL(file, import.meta.url))),
  );
  const hash = createHash('sha256');
  for (const source of sources) hash.update(source);
  const signature = hash.digest('hex');
  if (template?.signature !== signature) {
    const previous = template;
    const pending = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'short-studio-template-'));
      try {
        const serveUrl = await bundle({
          entryPoint: fileURLToPath(new URL('./video.tsx', import.meta.url)),
          outDir: directory,
          publicDir: join(directory, 'empty-public'),
        });
        process.once('exit', () => rmSync(directory, {recursive: true, force: true}));
        return serveUrl;
      } catch (error) {
        await rm(directory, {recursive: true, force: true});
        throw error;
      }
    })();
    template = {signature, bundle: pending};
    void pending.catch(() => {
      if (template?.bundle === pending) template = previous;
    });
  }
  const source = await template.bundle;
  const directory = await mkdtemp(join(tmpdir(), 'short-studio-render-'));
  try {
    await cp(source, directory, {recursive: true});
    await rm(join(directory, 'public'), {recursive: true, force: true});
    await symlink(resolve(assets), join(directory, 'public'), 'junction');
    return directory;
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}

export async function renderShort(
  directory: string,
  reportProgress?: (progress: number) => void,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const inputProps = projectSchema.parse(JSON.parse(await readFile(join(directory, 'project.json'), 'utf8')));
  const serveUrl = await projectBundle(join(directory, 'assets'));
  const output = join(directory, 'short.mp4');
  const temporaryOutput = join(directory, `short-${randomUUID()}.mp4`);

  const {cancel, cancelSignal} = makeCancelSignal();
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    signal?.throwIfAborted();
    const composition = await selectComposition({serveUrl, id: 'EducationalShort', inputProps});
    let lastProgress = -1;
    signal?.throwIfAborted();
    await renderMedia({
      cancelSignal,
      timeoutInMilliseconds: 60_000,
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      outputLocation: temporaryOutput,
      concurrency: 3,
      onProgress: ({progress}) => {
        reportProgress?.(progress);
        const milestone = Math.floor(progress * 4);
        if (milestone > lastProgress) {
          console.log(`Rendering ${milestone * 25}%`);
          lastProgress = milestone;
        }
      },
    });
    await rename(temporaryOutput, output);
    return output;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await Promise.all([rm(temporaryOutput, {force: true}), rm(serveUrl, {recursive: true, force: true})]);
  }
}

export async function renderDiagrams(directory: string, diagrams: Diagram[], signal?: AbortSignal) {
  const serveUrl = await projectBundle(join(directory, 'assets'));
  const {cancel, cancelSignal} = makeCancelSignal();
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    for (const [index, inputProps] of diagrams.entries()) {
      signal?.throwIfAborted();
      const composition = await selectComposition({serveUrl, id: 'DiagramClip', inputProps});
      signal?.throwIfAborted();
      await renderMedia({
        serveUrl,
        composition,
        inputProps,
        cancelSignal,
        codec: 'h264',
        muted: true,
        concurrency: 3,
        outputLocation: join(directory, `diagram-${index + 1}.mp4`),
      });
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await rm(serveUrl, {recursive: true, force: true});
  }
}
