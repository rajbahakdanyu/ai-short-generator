import {assetBlob} from './assets.ts';
import type {Draft, PaidInput} from './model.ts';
import {exportSceneTiming} from './scene-state.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const mutationHeaders = {'X-Short-Studio': '1'};
const jsonHeaders = {...mutationHeaders, 'Content-Type': 'application/json'};

export async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/studio/${path}`, init);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ApiError(detail?.error ?? `Studio returned HTTP ${response.status}.`, response.status);
  }
  return response;
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await api(path, init)).json();
}

export function post(path: string, body?: unknown) {
  if (body === undefined || body instanceof FormData)
    return api(path, {method: 'POST', headers: mutationHeaders, body});
  return api(path, {method: 'POST', headers: jsonHeaders, body: JSON.stringify(body)});
}

export async function startJob(path: string, body?: unknown) {
  const {id}: {id: string} = await (await post(path, body)).json();
  return id;
}

export function remove(path: string) {
  return api(path, {method: 'DELETE', headers: mutationHeaders});
}

export async function exportForm(draft: Draft) {
  const form = new FormData();
  form.set(
    'storyboard',
    JSON.stringify({
      title: draft.title,
      musicVolume: draft.musicVolume,
      scenes: draft.scenes.map((scene) => ({
        name: scene.name,
        sources: scene.sources,
        narration: scene.narration,
        kokoroVoice: scene.kokoroVoice,
        kind: scene.media?.kind,
        ...exportSceneTiming(scene),
        imagePrompt: scene.imagePrompt,
      })),
    }),
  );
  for (const [i, scene] of draft.scenes.entries()) {
    if (!scene.media) throw new Error(`Add a visual to scene ${i + 1}.`);
    form.set(`visual-${i}`, await assetBlob(scene.media), scene.media.name);
    if (scene.voice && !scene.voiceOutdated) form.set(`voice-${i}`, await assetBlob(scene.voice), 'voice');
  }
  if (draft.music) form.set('music', await assetBlob(draft.music), draft.music.name);
  return form;
}

export function paidBody(input: PaidInput, track?: File) {
  if (!track) return input;
  const form = new FormData();
  form.set('request', JSON.stringify(input));
  form.set('music', track);
  return form;
}
