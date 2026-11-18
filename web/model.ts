import type {KokoroVoice} from '../src/kokoro-voices.ts';
import type {Scene} from '../src/project.ts';
import {estimatedCaptions, FPS, narrationCaptions} from '../src/timing.ts';

export type Asset = {name: string; kind: 'image' | 'video' | 'audio'; source: string | Blob};
export type DraftScene = {
  id: string;
  name: string;
  narration: string;
  media?: Asset;
  voice?: Asset;
  kokoroVoice?: KokoroVoice;
  seconds?: number;
  frames?: number;
  imagePrompt?: string;
  captions?: Scene['captions'];
};
export type Draft = {title: string; scenes: DraftScene[]; music?: Asset};
export type Job = {
  phase: 'Uploading media' | 'Preparing scenes' | 'Rendering video' | 'Complete' | 'Failed';
  progress: number;
  error?: string;
  id?: string;
  hasDraft?: boolean;
  hasVideo?: boolean;
};

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

export const secondsFor = (scene: DraftScene) =>
  scene.seconds ?? Math.max(2, scene.narration.trim().split(/\s+/).filter(Boolean).length / 2.5);
export const captionsFor = (scene: DraftScene) =>
  scene.captions ??
  (scene.narration.trim()
    ? narrationCaptions(scene.narration.trim(), Math.ceil(secondsFor(scene) * FPS) + 3)
    : []);

export function freshScene(narration = ''): DraftScene {
  return {id: crypto.randomUUID(), name: 'Untitled scene', narration};
}

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function assetUrl(source: string) {
  const filename = source.startsWith('sample:') ? source.slice(7) : source.split('/').at(-1);
  return sampleFiles[`../demo/${filename}`] ?? source;
}

export async function assetBlob(asset: Asset) {
  if (typeof asset.source !== 'string') return asset.source;
  const response = await fetch(assetUrl(asset.source));
  if (!response.ok) throw new Error(`Could not read ${asset.name}.`);
  return response.blob();
}

export async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/studio/${path}`, init);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Studio returned HTTP ${response.status}.`);
  }
  return response;
}
