import {mkdir, readdir, readFile, rm, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {z} from 'zod';
import {ifMissing, readOptional, writeJson} from '../src/checkpoint.ts';
import type {localSettings} from '../src/local-settings.ts';
import {type LocalStoryboard, localStoryboardSchema} from '../src/local-storyboard.ts';
import {type PaidStage, paidBoardSchema} from '../src/paid.ts';

export const jobDirectory = (id: string) => resolve('output', `studio-${id}`);
export const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export type Usage = Record<PaidStage, number>;
export type Estimate = Record<PaidStage | 'limit', number>;

export function estimatedSpend(usage: Usage, estimate: Estimate) {
  return usage.script * estimate.script + usage.visual * estimate.visual + usage.voice * estimate.voice;
}

export type Job = {
  phase: 'Preparing scenes' | 'Rendering video' | 'Complete' | 'Failed' | 'Cancelled';
  progress: number;
  file?: string;
  draft?: 'project.json' | 'storyboard.json' | 'local-storyboard.json';
  error?: string;
  detail?: string;
  startedAt: number;
  usage?: Usage;
  estimate?: Estimate;
  paid?: {mode: 'plan' | 'prepare' | 'export'; video: boolean; fingerprint: string};
  local?: {mode: 'direct' | 'plan' | 'prepare'; settings: z.infer<typeof localSettings>};
};

const writes = new Map<string, Promise<void>>();
export async function saveJob(id: string, job: Job) {
  const snapshot = structuredClone(job);
  const previous = writes.get(id);
  const write = (previous?.catch(() => {}) ?? Promise.resolve()).then(() =>
    writeJson(join(jobDirectory(id), 'job.json'), snapshot),
  );
  writes.set(id, write);
  try {
    await write;
  } finally {
    if (writes.get(id) === write) writes.delete(id);
  }
}

export async function readJob(id: string): Promise<Job | undefined> {
  const manifest = await readOptional(join(jobDirectory(id), 'job.json'));
  if (!manifest) return;
  const job: Job = JSON.parse(manifest.toString());
  if (job.phase === 'Preparing scenes' || job.phase === 'Rendering video') {
    const directory = jobDirectory(id);
    const has = async (filename: string) =>
      (await stat(join(directory, filename)).catch(ifMissing(undefined)))?.isFile() === true;
    let draft = job.draft;
    if (!draft && (await has('project.json'))) draft = 'project.json';
    if (!draft && job.paid && (await has('storyboard.json'))) draft = 'storyboard.json';
    if (!draft && job.local?.mode !== 'direct' && job.local && (await has('local-storyboard.json')))
      draft = 'local-storyboard.json';
    return {
      ...job,
      draft,
      phase: 'Failed',
      error: 'Studio restarted during generation. Saved stages are available.',
    };
  }
  return job;
}

export async function createJob(id: string, paid?: Job['paid']) {
  await mkdir(join(jobDirectory(id), 'assets'), {recursive: true});
  const job: Job = {phase: 'Preparing scenes', progress: 0, startedAt: Date.now(), paid};
  await saveJob(id, job);
  return job;
}

export function restartJob(id: string, job: Job, phase: Job['phase']) {
  job.phase = phase;
  job.error = undefined;
  job.startedAt = Date.now();
  return saveJob(id, job);
}

export const isResumable = (job: Job) => !!job.draft && (job.phase === 'Failed' || job.phase === 'Cancelled');

export function jobStatus(job: Job) {
  return {
    phase: job.phase,
    progress: job.progress,
    error: job.error,
    detail: job.detail,
    startedAt: job.startedAt,
    usage: job.usage,
    spendingLimit: job.estimate?.limit,
    estimatedSpend: job.usage && job.estimate ? estimatedSpend(job.usage, job.estimate) : undefined,
    resumable: isResumable(job),
    resumeNeedsProviders: !!job.paid,
    hasVideo: !!job.file,
    hasDraft: !!job.draft,
    hasStoryboard: job.draft === 'local-storyboard.json',
    localMode: job.local?.mode,
  };
}

const readJsonFile = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

export async function readLocalBoard(id: string, settings: z.infer<typeof localSettings>) {
  const saved = await readJsonFile(join(jobDirectory(id), 'local-storyboard.json'));
  return localStoryboardSchema(settings).parse(saved) as LocalStoryboard;
}

export async function readDraft(id: string, draft: NonNullable<Job['draft']>, local: Job['local']) {
  const directory = jobDirectory(id);
  const manifest = await readJsonFile(join(directory, draft));
  if (draft === 'project.json') return {kind: 'project', manifest};
  if (draft === 'local-storyboard.json' && local) {
    const board = localStoryboardSchema(local.settings).parse(manifest);
    return {kind: 'local-storyboard', manifest: {...board, settings: local.settings}};
  }
  const board = paidBoardSchema.parse(manifest);
  const scenes = await Promise.all(
    board.scenes.map(async (scene, index) => {
      const prepared = await readOptional(join(directory, `scene-${index + 1}.json`));
      return prepared ? JSON.parse(prepared.toString()) : scene;
    }),
  );
  return {kind: 'storyboard', manifest: {...board, scenes}};
}

/** Job files are replaced atomically while generating, so entries may vanish between listing and stat. */
async function directorySize(directory: string): Promise<number> {
  const entries = await readdir(directory, {withFileTypes: true}).catch(ifMissing([]));
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return directorySize(path);
      if (!entry.isFile()) return 0;
      return (await stat(path).catch(ifMissing(undefined)))?.size ?? 0;
    }),
  );
  return sizes.reduce((sum, bytes) => sum + bytes, 0);
}

export async function listJobs(active?: string) {
  const dirs = await readdir(resolve('output'), {withFileTypes: true}).catch(ifMissing([]));
  const jobs = [];
  for (const dir of dirs) {
    const id = dir.name.slice(7);
    if (!dir.isDirectory() || !dir.name.startsWith('studio-') || !idPattern.test(id)) continue;
    const job = await readJob(id);
    if (!job) continue;
    jobs.push({
      id,
      startedAt: job.startedAt,
      phase: id === active ? 'Running' : job.phase,
      bytes: await directorySize(jobDirectory(id)),
    });
  }
  return jobs.sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteJob(id: string) {
  return rm(jobDirectory(id), {recursive: true, force: true});
}
