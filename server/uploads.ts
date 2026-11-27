import {createWriteStream} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import type {IncomingMessage} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Busboy} from '@fastify/busboy';

const maxUpload = 256 * 1024 * 1024;

export async function parseUpload(req: IncomingMessage) {
  if (Number(req.headers['content-length']) > maxUpload) throw new Error('Upload exceeds 256 MB.');
  const contentType = req.headers['content-type'];
  if (!contentType) throw new Error('Upload must be sent as multipart form data.');
  const parser = new Busboy({
    headers: {...req.headers, 'content-type': contentType},
    limits: {fieldSize: 512_000, files: 201, fields: 1, parts: 203, fileSize: 64 * 1024 * 1024},
  });
  const directory = await mkdtemp(join(tmpdir(), 'short-studio-upload-'));
  const cleanup = () => rm(directory, {recursive: true, force: true});
  const files = new Map<string, string>();
  const fields = new Map<string, string>();
  const writes: Promise<void>[] = [];
  const abort = new AbortController();
  const fail = (message: string) => parser.destroy(new Error(message));

  parser.on('file', (key, stream) => {
    const path = join(directory, String(files.size));
    if (files.has(key)) {
      stream.resume();
      fail('Duplicate upload field.');
      return;
    }
    files.set(key, path);
    stream.on('limit', () => fail('An uploaded file exceeds 64 MB.'));
    writes.push(
      pipeline(stream, createWriteStream(path, {flags: 'wx'}), {signal: abort.signal}).catch((error) => {
        parser.destroy(error);
      }),
    );
  });
  parser.on('field', (key, value, nameTruncated, valueTruncated) => {
    if (nameTruncated || valueTruncated) fail('Upload metadata is too large.');
    else fields.set(key, value);
  });
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const)
    parser.on(event, () => fail('Upload contains too many parts.'));

  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxUpload) callback(new Error('Upload exceeds 256 MB.'));
      else callback(null, chunk);
    },
  });
  const interrupted = () => parser.destroy(new Error('Upload interrupted.'));
  req.on('aborted', interrupted);
  req.on('error', interrupted);
  try {
    await pipeline(req.pipe(meter), parser, {signal: AbortSignal.timeout(120_000)});
    await Promise.all(writes);
    return {files, fields, cleanup};
  } catch (error) {
    abort.abort();
    await Promise.allSettled(writes);
    await cleanup();
    throw error;
  } finally {
    req.unpipe(meter);
    req.off('aborted', interrupted);
    req.off('error', interrupted);
    req.resume();
  }
}

export type Upload = Awaited<ReturnType<typeof parseUpload>>;

export function uploadPart(form: Upload, key: string) {
  const path = form.files.get(key);
  if (!path) throw new Error(`Missing file for ${key}.`);
  return path;
}
