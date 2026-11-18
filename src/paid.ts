import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {audioFrames, normalizeSpeech, toJpeg} from './media.ts';
import {narrationCaptions, type Project} from './project.ts';
import {type PaidProviders, setting} from './providers/config.ts';
import {generateImage} from './providers/image.ts';
import {generateScript} from './providers/script.ts';
import {generateVoice} from './providers/voice.ts';
import {generateNarration, kokoroRuntime} from './storyboard.ts';

const boardSchema = z.object({
  title: z.string().trim().min(1),
  scenes: z
    .array(
      z.object({
        narration: z.string().trim().min(1),
        imagePrompt: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(8),
});

export async function buildPaidShort(
  {script, image: imageProvider, voice}: PaidProviders,
  topic: string,
  directory: string,
): Promise<Project | string> {
  const imageOptions = imageProvider && setting('IMAGE_OPTIONS');
  const options = imageOptions ? z.record(z.string(), z.unknown()).parse(JSON.parse(imageOptions)) : {};
  if (voice?.provider === 'kokoro') await kokoroRuntime();
  console.log(`Storyboard · ${script.provider} / ${script.model}`);
  if (imageProvider && voice)
    console.log(
      `Illustrations · ${imageProvider.provider} / ${imageProvider.model} · Narration · ${voice.provider}`,
    );
  const system = [
    'Write an accurate English educational Short with eight scenes and approximately 100 spoken words total.',
    'Open with a concrete question or surprising fact, then resolve it. Skip intros and calls to subscribe.',
    'Return only a JSON object of the exact shape {"title":"...","scenes":[{"narration":"...","imagePrompt":"..."}]}.',
    'Each narration is spoken text. Each image prompt describes a distinct portrait illustration for that beat.',
    'Vary framing and composition across scenes while keeping the visual palette consistent.',
  ].join(' ');
  const text = (await generateScript(script, system, topic)).trim();
  if (!text) throw new Error('The provider returned an empty storyboard.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/gi, ''));
  } catch {
    throw new Error('The provider returned an invalid JSON storyboard.');
  }
  const board = boardSchema.parse(parsed);
  const storyboardFile = join(directory, 'storyboard.json');
  await writeFile(
    storyboardFile,
    `${JSON.stringify(
      {
        title: board.title,
        scenes: board.scenes.map((scene, index) => ({...scene, image: `assets/scene-${index + 1}.jpg`})),
      },
      null,
      2,
    )}\n`,
  );
  if (!imageProvider || !voice) return storyboardFile;

  const assets = join(directory, 'assets');
  const scenes: Project['scenes'] = [];
  for (const [index, scene] of board.scenes.entries()) {
    const id = `scene-${index + 1}`;
    const image = `${id}.jpg`;
    const temporaryImage = join(assets, `${id}.image`);
    console.log(`Scene ${index + 1}/${board.scenes.length} · illustration`);
    const prompt = `${scene.imagePrompt} Cinematic portrait framing with the subject in the central 80%. No text or logos.`;
    await writeFile(temporaryImage, await generateImage(imageProvider, prompt, options));
    await toJpeg(temporaryImage, join(assets, image));
    await rm(temporaryImage);
  }

  if (voice.provider === 'kokoro') {
    await generateNarration(
      board.scenes.map(({narration}, index) => ({narration, index: index + 1})),
      directory,
      assets,
    );
  }
  for (const [index, scene] of board.scenes.entries()) {
    const id = `scene-${index + 1}`;
    const image = `${id}.jpg`;
    const audio = `${id}.wav`;
    if (voice.provider !== 'kokoro') {
      console.log(`Scene ${index + 1}/${board.scenes.length} · narration`);
      const temporarySpeech = join(assets, `${id}.speech`);
      await writeFile(temporarySpeech, await generateVoice(voice, scene.narration));
      await normalizeSpeech(temporarySpeech, join(assets, audio));
      await rm(temporarySpeech);
    }
    const frames = await audioFrames(join(assets, audio));
    scenes.push({...scene, image, audio, frames, captions: narrationCaptions(scene.narration, frames)});
  }
  return {title: board.title, scenes};
}
