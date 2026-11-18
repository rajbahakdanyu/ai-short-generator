import {randomUUID} from 'node:crypto';
import {readFile, rename, rm, writeFile} from 'node:fs/promises';

export async function writeAtomic(path: string, data: string | Buffer) {
  const pending = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, data, {mode: 0o600});
    await rename(pending, path);
  } finally {
    await rm(pending, {force: true});
  }
}

export async function readOptional(path: string) {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function writeJson(path: string, data: unknown) {
  await writeAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}
