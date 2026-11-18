import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FPS} from './project.ts';

export const run = promisify(execFile);

export async function toWav(input: string, output: string) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', input, '-vn', '-ar', '48000', output]);
}

export async function toJpeg(input: string, output: string) {
  await run('ffmpeg', [
    '-v', 'error', '-nostdin', '-i', input, '-frames:v', '1', '-update', '1', '-q:v', '2', output,
  ]);
}

export async function normalizeSpeech(input: string, output: string) {
  await run('ffmpeg', [
    '-v', 'error', '-nostdin', '-i', input,
    '-af', 'highpass=f=75,loudnorm=I=-16:TP=-2:LRA=5', '-ar', '48000', output,
  ]);
}

export async function audioFrames(path: string) {
  const {stdout} = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid audio duration for ${path}.`);
  return Math.ceil(seconds * FPS) + 3;
}
