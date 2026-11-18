import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FPS} from './project.ts';

const exec = promisify(execFile);
const mediaFormats =
  'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,wav,flac,mp3,ogg,aac,aiff,image2,jpeg_pipe,png_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,avif';
const localMedia = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', mediaFormats];
export const run = (command: string, args: string[], signal?: AbortSignal) =>
  exec(command, args, {signal, timeout: 180_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024});

async function probe(input: string, kind: 'video' | 'image' | 'audio', limit = 120, signal?: AbortSignal) {
  const {stdout} = await run(
    'ffprobe',
    [
      '-v',
      'error',
      ...localMedia,
      '-show_entries',
      'format=duration:stream=codec_type,width,height,duration,channels',
      '-of',
      'json',
      input,
    ],
    signal,
  );
  const data = JSON.parse(stdout) as {
    format?: {duration?: string};
    streams?: {codec_type: string; width?: number; height?: number; duration?: string; channels?: number}[];
  };
  const stream = data.streams?.find((stream) => stream.codec_type === (kind === 'image' ? 'video' : kind));
  if (!stream) throw new Error(`Expected a valid ${kind} file.`);
  if (kind !== 'audio' && (!stream.width || !stream.height || stream.width > 4096 || stream.height > 4096))
    throw new Error('Visuals must be at most 4096 pixels per side.');
  if (kind === 'audio' && (stream.channels ?? 0) > 8) throw new Error('Audio supports up to eight channels.');
  const duration = Number(data.format?.duration ?? stream.duration);
  if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0 || duration > limit))
    throw new Error(`${kind} duration must be between 0 and ${limit} seconds.`);
}

export async function toWav(input: string, output: string, limit = 600, signal?: AbortSignal) {
  await probe(input, 'audio', limit, signal);
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      ...localMedia,
      '-i',
      input,
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      output,
    ],
    signal,
  );
}

export async function toJpeg(input: string, output: string, signal?: AbortSignal) {
  await probe(input, 'image', undefined, signal);
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      ...localMedia,
      '-i',
      input,
      '-frames:v',
      '1',
      '-update',
      '1',
      '-q:v',
      '2',
      output,
    ],
    signal,
  );
}

export async function fitVideoToScene(input: string, output: string, frames: number, signal?: AbortSignal) {
  await probe(input, 'video', undefined, signal);
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-stream_loop',
      '-1',
      '-an',
      ...localMedia,
      '-i',
      input,
      '-map',
      '0:V:0',
      '-an',
      '-sn',
      '-dn',
      '-vf',
      `fps=${FPS}:start_time=0,scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
      '-frames:v',
      String(frames),
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output,
    ],
    signal,
  );
}

export async function normalizeSpeech(input: string, output: string, signal?: AbortSignal) {
  await probe(input, 'audio', undefined, signal);
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      ...localMedia,
      '-i',
      input,
      '-af',
      'highpass=f=75,loudnorm=I=-16:TP=-2:LRA=5',
      '-ac',
      '2',
      '-ar',
      '48000',
      output,
    ],
    signal,
  );
}

export async function audioFrames(path: string, signal?: AbortSignal) {
  const {stdout} = await run(
    'ffprobe',
    ['-v', 'error', ...localMedia, '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
    signal,
  );
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid audio duration for ${path}.`);
  return Math.ceil(seconds * FPS) + 3;
}
