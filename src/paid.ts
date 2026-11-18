import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadEnvFile} from 'node:process';
import OpenAI from 'openai';
import {z} from 'zod';
import {audioFrames, normalizeSpeech, toJpeg} from './media.ts';
import {narrationCaptions, type Project} from './project.ts';

const boardSchema = z.object({
  title: z.string().trim().min(1),
  scenes: z.array(z.object({
    narration: z.string().trim().min(1),
    imagePrompt: z.string().trim().min(1),
  })).min(1).max(8),
});

export function paidProvider() {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('Paid mode requires OPENAI_API_KEY. Set it in .env or your shell.');
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const endpoint = new URL(baseURL);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('OPENAI_BASE_URL must be an HTTP(S) API base URL without credentials.');
  }
  const official = endpoint.origin === 'https://api.openai.com';
  const client = new OpenAI({apiKey, baseURL, maxRetries: 0, timeout: 240_000});
  return {client, endpoint, official};
}

export async function buildPaidShort(
  provider: ReturnType<typeof paidProvider>,
  topic: string,
  directory: string,
  planOnly: boolean,
): Promise<Project | string> {
  const {client, endpoint, official} = provider;
  const scriptModel = process.env.SCRIPT_MODEL?.trim() || (official ? 'gpt-4.1-mini' : '');
  const imageModel = process.env.IMAGE_MODEL?.trim() || (official ? 'gpt-image-1-mini' : '');
  const voiceModel = process.env.VOICE_MODEL?.trim() || (official ? 'gpt-4o-mini-tts' : '');
  const voice = process.env.VOICE?.trim() || (official ? 'onyx' : '');
  if (!scriptModel || (!planOnly && (!imageModel || !voiceModel || !voice))) {
    throw new Error(planOnly
      ? 'Set SCRIPT_MODEL for this provider.'
      : 'Set SCRIPT_MODEL, IMAGE_MODEL, VOICE_MODEL, and VOICE for this provider. Use --plan-only for a text-only provider.');
  }

  console.log(`Paid requests to ${endpoint.origin} · writing storyboard`);
  const response = await client.chat.completions.create({
    model: scriptModel,
    messages: [
      {
        role: 'system',
        content: [
          'Write an accurate English educational Short with eight scenes and approximately 100 spoken words total.',
          'Open with a concrete question or surprising fact, then resolve it. Skip intros and calls to subscribe.',
          'Return only a JSON object of the exact shape {"title":"...","scenes":[{"narration":"...","imagePrompt":"..."}]}.',
          'Each narration is spoken text. Each image prompt describes a distinct portrait illustration for that beat.',
          'Vary framing and composition across scenes while keeping the visual palette consistent.',
        ].join(' '),
      },
      {role: 'user', content: topic},
    ],
  });
  const text = response.choices[0]?.message.content?.trim();
  if (!text) throw new Error('The provider returned an empty storyboard.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/gi, ''));
  } catch {
    throw new Error('The provider returned an invalid JSON storyboard.');
  }
  const board = boardSchema.parse(parsed);
  const storyboardFile = join(directory, 'storyboard.json');
  await writeFile(storyboardFile, JSON.stringify({
    title: board.title,
    scenes: board.scenes.map((scene, index) => ({...scene, image: `assets/scene-${index + 1}.jpg`})),
  }, null, 2) + '\n');
  if (planOnly) return storyboardFile;

  const assets = join(directory, 'assets');
  const scenes: Project['scenes'] = [];
  for (const [index, scene] of board.scenes.entries()) {
    const id = `scene-${index + 1}`;
    const image = `${id}.jpg`;
    const audio = `${id}.wav`;
    const temporaryImage = join(assets, `${id}.image`);
    const temporarySpeech = join(assets, `${id}.speech`);
    console.log(`Scene ${index + 1}/${board.scenes.length} · paid illustration`);
    const result = await client.images.generate({
      model: imageModel,
      prompt: `${scene.imagePrompt} Cinematic portrait framing with the subject in the central 80%. No text or logos.`,
      ...(process.env.IMAGE_SIZE?.trim() ? {size: process.env.IMAGE_SIZE.trim()} : {}),
      ...(official && imageModel.startsWith('gpt-image') ? {
        size: process.env.IMAGE_SIZE?.trim() || '1024x1536',
        quality: 'medium',
        output_format: 'jpeg',
      } : {}),
    });
    const generated = result.data?.[0];
    if (generated?.b64_json) {
      await writeFile(temporaryImage, Buffer.from(generated.b64_json, 'base64'));
    } else if (generated?.url) {
      const downloaded = await fetch(generated.url, {signal: AbortSignal.timeout(60_000)});
      if (!downloaded.ok) throw new Error(`Image download failed for ${id} (HTTP ${downloaded.status}).`);
      await writeFile(temporaryImage, Buffer.from(await downloaded.arrayBuffer()));
    } else {
      throw new Error(`The provider returned no image for ${id}.`);
    }
    await toJpeg(temporaryImage, join(assets, image));
    await rm(temporaryImage);

    console.log(`Scene ${index + 1}/${board.scenes.length} · paid narration`);
    const speech = await client.audio.speech.create({
      model: voiceModel,
      voice,
      input: scene.narration,
      response_format: 'wav',
      ...(official && voiceModel.startsWith('gpt-4o-mini-tts') ? {
        instructions: 'Speak like a curious documentary host. Use natural phrasing and emphasis, with a conversational pace.',
      } : {}),
    });
    await writeFile(temporarySpeech, Buffer.from(await speech.arrayBuffer()));
    await normalizeSpeech(temporarySpeech, join(assets, audio));
    await rm(temporarySpeech);
    const frames = await audioFrames(join(assets, audio));
    scenes.push({...scene, image, audio, frames, captions: narrationCaptions(scene.narration, frames)});
  }
  return {title: board.title, scenes};
}
