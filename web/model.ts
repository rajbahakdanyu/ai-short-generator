import type {KokoroVoice} from '../src/kokoro-voices.ts';
import type {Scene} from '../src/project.ts';
import type {PaidSelection} from '../src/providers/catalog.ts';
import {FPS, narrationCaptions} from '../src/timing.ts';

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
  sources?: string;
  voiceOutdated?: boolean;
  captions?: Scene['captions'];
};
export type Draft = {title: string; scenes: DraftScene[]; music?: Asset; musicVolume?: number};
export type Job = {
  phase: 'Uploading media' | 'Preparing scenes' | 'Rendering video' | 'Complete' | 'Failed' | 'Cancelled';
  progress: number;
  error?: string;
  id?: string;
  hasDraft?: boolean;
  hasVideo?: boolean;
  hasStoryboard?: boolean;
  localMode?: 'direct' | 'plan' | 'prepare';
  detail?: string;
  startedAt?: number;
  resumable?: boolean;
  resumeNeedsProviders?: boolean;
  usage?: {script: number; visual: number; voice: number};
  spendingLimit?: number;
  estimatedSpend?: number;
};
export type JobSummary = {id: string; startedAt: number; phase: string; bytes: number};
export type StudioDialog =
  | 'local'
  | 'local-review'
  | 'script'
  | 'new'
  | 'sample'
  | 'export'
  | 'paid'
  | 'import'
  | 'library'
  | 'outputs';
export type PaidInput = {
  topic: string;
  mode: 'plan' | 'prepare' | 'export';
  selection: PaidSelection;
  video?: boolean;
  videoKey?: string;
  board?: {
    title: string;
    scenes: Pick<DraftScene, 'name' | 'narration' | 'imagePrompt' | 'sources'>[];
  };
  resumeLimit?: number;
  estimate?: {script: number; visual: number; voice: number; limit: number};
};

export const secondsFor = (scene: DraftScene) =>
  (scene.voiceOutdated ? undefined : scene.seconds) ??
  Math.max(2, scene.narration.trim().split(/\s+/).filter(Boolean).length / 2.5);
export const framesFor = (scene: DraftScene) =>
  (scene.voiceOutdated ? undefined : scene.frames) ?? Math.ceil(secondsFor(scene) * FPS) + 3;
export const captionsFor = (scene: DraftScene) =>
  (scene.voiceOutdated ? undefined : scene.captions) ??
  (scene.narration.trim() ? narrationCaptions(scene.narration.trim(), framesFor(scene)) : []);

export function freshScene(narration = ''): DraftScene {
  return {id: crypto.randomUUID(), name: 'Untitled scene', narration};
}

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export const sceneNumber = (index: number) => String(index + 1).padStart(2, '0');
