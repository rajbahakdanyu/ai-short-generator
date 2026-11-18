import type {Asset, DraftScene} from './model.ts';

export function newRecording(voice: Asset, seconds: number): Partial<DraftScene> {
  return {voice, seconds, frames: undefined, captions: undefined, voiceOutdated: false};
}
