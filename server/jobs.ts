import {mkdir, readdir, rm, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {z} from 'zod';
import {readOptional, writeJson} from '../src/checkpoint.ts';
import type {localSettings} from '../src/local-settings.ts';

export const jobDirectory = (id: string) => resolve('output', `studio-${id}`);
export const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

import type {PaidStage} from '../src/paid.ts';
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
      (
        await stat(join(directory, filename)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        })
      )?.isFile() === true;
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

async function directorySize(directory: string): Promise<number> {
  const entries = await readdir(directory, {withFileTypes: true});
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return directorySize(path);
      return entry.isFile() ? (await stat(path)).size : 0;
    }),
  );
  return sizes.reduce((sum, bytes) => sum + bytes, 0);
}

export async function listJobs(active?: string) {
  const dirs = await readdir(resolve('output'), {withFileTypes: true}).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
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
