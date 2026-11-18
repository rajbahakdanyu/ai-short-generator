import type {Scene} from './project.ts';

export const FPS = 30;

export function estimatedCaptions(phrases: string[], frames: number): Scene['captions'] {
  // Allow extra time for pauses at the ends of sentences.
  const weights = phrases.map((text) => text.length + (/[.!?]$/.test(text) ? 8 : 0));
  const secondsPerWeight = (frames - 3) / FPS / weights.reduce((sum, weight) => sum + weight, 0);
  let end = 0;
  return phrases.map((text, index) => {
    const start = end;
    end += weights[index] * secondsPerWeight;
    return {text, start, end};
  });
}

export function narrationCaptions(narration: string, frames: number): Scene['captions'] {
  const phrases = narration.match(/[^\s]+(?:[ \t]+[^\s]+){0,4}/g) ?? [narration];
  return estimatedCaptions(phrases, frames);
}
