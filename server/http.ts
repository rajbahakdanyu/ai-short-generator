import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {pipeline} from 'node:stream/promises';

const maxJsonBytes = 160_000;

export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
}

export function isLocalRequest(req: IncomingMessage) {
  const host = req.headers.host ?? '';
  return (
    /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) &&
    (!req.headers.origin || req.headers.origin === `http://${host}`)
  );
}

export async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > maxJsonBytes) throw new Error('This studio request is too long.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}

export function mediaType(filename: string) {
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  if (filename.endsWith('.mp4')) return 'video/mp4';
  return 'audio/wav';
}

export async function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  contentType: string,
) {
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
