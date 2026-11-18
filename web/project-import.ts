import {z} from 'zod';
import {projectSchema, storyboardSchema} from '../src/project.ts';
import {FPS} from '../src/timing.ts';
import {type Asset, type Draft, freshScene} from './model.ts';

type LoadAsset = (filename: string, kind: Asset['kind']) => Promise<Asset | undefined>;

function namedScene(narration: string, index: number) {
  return {...freshScene(narration), name: `Scene ${index + 1}`};
}

async function loadStoryboard(input: unknown, load: LoadAsset): Promise<Draft> {
  const {title, scenes, music, musicVolume} = storyboardSchema.parse(input);
  return {
    title,
    scenes: await Promise.all(
      scenes.map(async (scene, index) => ({
        ...namedScene(scene.narration, index),
        name: scene.name ?? `Scene ${index + 1}`,
        sources: scene.sources,
        imagePrompt: scene.imagePrompt,
        kokoroVoice: scene.kokoroVoice,
        media: await loadVisual(scene, load),
        voice: scene.audio ? await load(scene.audio, 'audio') : undefined,
        seconds: scene.frames ? scene.frames / FPS : undefined,
        frames: scene.frames,
        captions: scene.captions,
      })),
    ),
    musicVolume,
    music: music ? await load(music, 'audio') : undefined,
  };
}

async function loadVisual(scene: {video?: string; image?: string}, load: LoadAsset) {
  if (scene.video) return load(scene.video, 'video');
  if (scene.image) return load(scene.image, 'image');
}

async function loadProject(input: unknown, load: LoadAsset): Promise<Draft> {
  const {title, scenes, music, musicVolume} = projectSchema.parse(input);
  const fromAssets: LoadAsset = (file, kind) => load(`assets/${file}`, kind);
  return {
    title,
    scenes: await Promise.all(
      scenes.map(async (scene, index) => {
        const [media, voice] = await Promise.all([
          loadVisual(scene, fromAssets),
          fromAssets(scene.audio, 'audio'),
        ]);
        if (!voice || ((scene.image || scene.video) && !media)) {
          throw new Error(
            `Scene ${index + 1} is missing prepared media. Select the folder containing project.json and assets/.`,
          );
        }
        return {
          ...namedScene(scene.narration, index),
          name: scene.name ?? `Scene ${index + 1}`,
          sources: scene.sources,
          imagePrompt: scene.imagePrompt,
          kokoroVoice: scene.kokoroVoice,
          media,
          voice,
          frames: scene.frames,
          seconds: scene.frames / FPS,
          captions: scene.captions,
        };
      }),
    ),
    musicVolume,
    music: music ? await fromAssets(music, 'audio') : undefined,
  };
}

const relativeName = (file: File) => file.webkitRelativePath || file.name;

export async function importFolder(files: File[]): Promise<Draft> {
  const manifestFiles = files.filter(
    (file) => file.name === 'project.json' || file.name === 'storyboard.json',
  );
  const shallowest = Math.min(...manifestFiles.map((file) => relativeName(file).split('/').length));
  const candidates = manifestFiles.filter((file) => relativeName(file).split('/').length === shallowest);
  const projects = candidates.filter((file) => file.name === 'project.json');
  const eligible = projects.length ? projects : candidates;
  if (eligible.length !== 1) throw new Error('Select one folder containing project.json or storyboard.json.');
  const manifest = eligible[0];
  const directory = relativeName(manifest).split('/').slice(0, -1).join('/');
  const byPath = new Map(files.map((file) => [relativeName(file), file]));
  const load: LoadAsset = async (name, kind) => {
    const path = name.replaceAll('\\', '/');
    const parts = path.startsWith('/') ? [] : directory.split('/').filter(Boolean);
    for (const segment of path.split('/')) {
      if (segment === '..') parts.pop();
      else if (segment && segment !== '.') parts.push(segment);
    }
    const file = byPath.get(parts.join('/'));
    const candidates = files.filter(
      (item) => path.startsWith('/') && path.endsWith(`/${relativeName(item)}`),
    );
    const source = file ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (source) return {kind, name: source.name, source};
  };
  const input: unknown = JSON.parse(await manifest.text());
  return manifest.name === 'project.json' ? loadProject(input, load) : loadStoryboard(input, load);
}

export async function importJob(id: string): Promise<Draft> {
  const base = `/api/studio/jobs/${id}`;
  const response = await fetch(`${base}/draft`);
  if (!response.ok) throw new Error('Could not open the generated project.');
  const {kind, manifest} = z
    .object({
      kind: z.enum(['project', 'storyboard']),
      manifest: z.unknown(),
    })
    .parse(await response.json());
  const load: LoadAsset = async (file, kind) => {
    const asset = await fetch(`${base}/${file.startsWith('assets/') ? file : `assets/${file}`}`);
    if (!asset.ok) throw new Error(`Could not open generated asset ${file}.`);
    return {kind, name: file.split('/').at(-1) ?? file, source: await asset.blob()};
  };
  return kind === 'storyboard' ? loadStoryboard(manifest, load) : loadProject(manifest, load);
}
