import {estimatedCaptions, FPS} from '../src/timing.ts';
import type {Asset, Draft} from './model.ts';

const sampleFiles = import.meta.glob(
  ['../demo/scene-{1,3,4}.jpg', '../demo/*.flac', '../demo/accretion-disk.mp4'],
  {eager: true, query: '?url', import: 'default'},
) as Record<string, string>;
const sample = [
  ['The hook', 'scene-1.jpg', 3.34, ['Black holes are invisible.', 'So what is', 'that glowing ring?']],
  [
    'The accretion disk',
    'accretion-disk.mp4',
    5.74,
    [
      'That light comes from gas',
      'swirling outside the black hole.',
      'The gas gets so hot',
      'it starts to glow.',
    ],
  ],
  [
    'Bent light',
    'scene-3.jpg',
    5.61,
    [
      'Gravity bends the light.',
      'It can even make gas',
      'behind the black hole',
      'appear above and below it.',
    ],
  ],
  [
    'The payoff',
    'scene-4.jpg',
    3.92,
    ['The glow traces its outline.', 'The black hole itself', 'stays dark.'],
  ],
] as const;

export const sampleDraft: Draft = {
  title: 'Why do black holes look bright?',
  scenes: sample.map(([name, file, seconds, phrases], index) => ({
    id: `sample-${index}`,
    name,
    narration: phrases.join(' '),
    seconds,
    media: {kind: file.endsWith('.mp4') ? 'video' : 'image', name: file, source: `sample:${file}`},
    voice: {kind: 'audio', name: 'Kokoro · Heart', source: `sample:scene-${index + 1}.flac`},
    captions: estimatedCaptions([...phrases], Math.ceil(seconds * FPS) + 3),
  })),
};

export function assetUrl(source: string) {
  return source.startsWith('sample:') ? (sampleFiles[`../demo/${source.slice(7)}`] ?? source) : source;
}

export async function assetBlob(asset: Asset) {
  if (typeof asset.source !== 'string') return asset.source;
  const response = await fetch(assetUrl(asset.source));
  if (!response.ok) throw new Error(`Could not read ${asset.name}.`);
  return response.blob();
}

export async function audioDuration(source: Blob) {
  const context = new AudioContext();
  try {
    return (await context.decodeAudioData(await source.arrayBuffer())).duration;
  } finally {
    await context.close();
  }
}
