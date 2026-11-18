export const defaultKokoroVoice = 'af_heart';

export const kokoroVoices = {
  af_heart: 'Heart · US English (default)',
  af_bella: 'Bella · US English',
  am_michael: 'Michael · US English',
  am_fenrir: 'Fenrir · US English',
  bf_emma: 'Emma · UK English',
  bm_george: 'George · UK English',
} as const;

export type KokoroVoice = keyof typeof kokoroVoices;

export function isKokoroVoice(value: string): value is KokoroVoice {
  return Object.hasOwn(kokoroVoices, value);
}

export function parseKokoroVoice(value: string): KokoroVoice {
  if (isKokoroVoice(value)) return value;
  throw new Error(`Unknown Kokoro voice "${value}". Choose ${Object.keys(kokoroVoices).join(', ')}.`);
}
