import {z} from 'zod';
import {kokoroVoiceSchema, maxCaptions, maxScenes, projectVersion, sceneFrames} from '../src/project.ts';
import {type Asset, assetBlob, type Draft} from './model.ts';

const maxFileBytes = 256 * 1024 * 1024;
const encodedAsset = z.object({
  name: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio']),
  data: z.string(),
});
const draftFile = z.object({
  format: z.literal('short-studio-draft'),
  version: projectVersion,
  title: z.string().max(200),
  scenes: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().max(200),
        narration: z.string().max(4000),
        sources: z.string().max(4000).optional(),
        imagePrompt: z.string().max(4000).optional(),
        kokoroVoice: kokoroVoiceSchema.optional(),
        seconds: z.number().positive().max(120).optional(),
        frames: sceneFrames.optional(),
        captions: z
          .array(z.object({text: z.string().max(4000), start: z.number(), end: z.number()}))
          .max(maxCaptions)
          .optional(),
        voiceOutdated: z.boolean().optional(),
        media: encodedAsset.optional(),
        voice: encodedAsset.optional(),
      }),
    )
    .min(1)
    .max(maxScenes),
  music: encodedAsset.optional(),
  musicVolume: z.number().min(0).max(1).optional(),
});

export async function downloadDraft(draft: Draft) {
  let bytes = 0;
  async function encode(asset?: Asset) {
    if (!asset) return;
    const blob = await assetBlob(asset);
    bytes += blob.size;
    if (bytes > (maxFileBytes * 3) / 4 - 1_000_000)
      throw new Error('The editable draft is too large to download in one file.');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return {name: asset.name, kind: asset.kind, data};
  }
  const {music, scenes, ...metadata} = draft;
  const items = [];
  for (const {media, voice, ...scene} of scenes) {
    items.push({...scene, id: crypto.randomUUID(), media: await encode(media), voice: await encode(voice)});
  }
  const data = JSON.stringify({
    ...metadata,
    format: 'short-studio-draft',
    version: 1,
    music: await encode(music),
    scenes: items,
  });
  const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${
    draft.title
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .slice(0, 70) || 'untitled'
  }.short-studio.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openDraftFile(file: File): Promise<Draft> {
  if (file.size > maxFileBytes) throw new Error('Editable draft files support up to 256 MB.');
  const {scenes, title, music, musicVolume} = draftFile.parse(JSON.parse(await file.text()));
  async function decode(asset: z.infer<typeof encodedAsset> | undefined, kinds: Asset['kind'][]) {
    if (!asset) return;
    const {name, kind, data} = asset;
    if (!kinds.includes(kind) || !/^data:[\w/+.-]*;base64,/.test(data))
      throw new Error(`Invalid saved media for ${name}.`);
    const source = await (await fetch(data)).blob();
    return {name, kind, source};
  }
  const items = [];
  const ids = new Set<string>();
  for (const {media, voice, ...scene} of scenes) {
    if (ids.has(scene.id)) throw new Error('Editable draft contains duplicate scenes.');
    ids.add(scene.id);
    items.push({
      ...scene,
      media: await decode(media, ['image', 'video']),
      voice: await decode(voice, ['audio']),
    });
  }
  return {title, scenes: items, music: await decode(music, ['audio']), musicVolume};
}
