import {createReadStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import OpenAI from 'openai';
import {zodTextFormat} from 'openai/helpers/zod';
import {z} from 'zod';
import {groupWords, type Project} from './project.ts';
import {audioFrames} from './media.ts';

const storyboardSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(z.object({
    narration: z.string().min(1),
    imagePrompt: z.string().min(1),
  })).length(8),
});

export async function generateProject(topic: string, assets: string): Promise<Project> {
  const client = new OpenAI({maxRetries: 0, timeout: 240_000});
  console.log('Writing storyboard');
  const response = await client.responses.parse({
    model: process.env.SCRIPT_MODEL || 'gpt-4.1-mini',
    instructions: [
      'Write an English educational short for a general audience.',
      'Return exactly eight scenes and aim for 95 to 105 spoken words total for a roughly 45-second video.',
      'Open with a concrete surprise or question in the first sentence. Skip intros and calls to subscribe.',
      'Each scene should add a new piece of the explanation. End by resolving the opening hook.',
      'Use accurate established facts and qualify uncertainty. Do not invent statistics or citations.',
      'Write natural spoken narration without markup, production notes, or headings.',
      'Give each scene a distinct, self-contained image prompt that depicts its specific narration beat.',
      'Keep the visual palette consistent and vary shot scale, composition, and angle across scenes.',
    ].join(' '),
    input: topic,
    text: {format: zodTextFormat(storyboardSchema, 'storyboard')},
  });
  const board = response.output_parsed;
  if (!board) throw new Error('The model did not return a storyboard.');

  const scenes: Project['scenes'] = [];
  for (const [index, scene] of board.scenes.entries()) {
    const id = `scene-${index + 1}`;
    const image = `${id}.jpg`;
    const audio = `${id}.wav`;
    const audioPath = join(assets, audio);

    console.log(`Scene ${index + 1}/${board.scenes.length} · illustration`);
    const result = await client.images.generate({
      model: process.env.IMAGE_MODEL || 'gpt-image-1-mini',
      size: '1024x1536',
      quality: 'medium',
      output_format: 'jpeg',
      prompt: [
        scene.imagePrompt,
        'Cinematic documentary illustration, atmospheric lighting, portrait framing.',
        'Keep the main subject within the central 80% of the width for a 9:16 crop.',
        'No printed text, logos, captions or borders.',
      ].join(' '),
    });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new Error(`No illustration returned for ${id}.`);
    await writeFile(join(assets, image), Buffer.from(encoded, 'base64'));

    console.log(`Scene ${index + 1}/${board.scenes.length} · narration and captions`);
    const speech = await client.audio.speech.create({
      model: process.env.VOICE_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.VOICE || 'onyx',
      input: scene.narration,
      instructions: 'Deliver a clear, measured cinematic documentary narration in English.',
      response_format: 'wav',
    });
    await writeFile(audioPath, Buffer.from(await speech.arrayBuffer()));
    const transcript = await client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: 'whisper-1',
      language: 'en',
      prompt: scene.narration,
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    });
    const captions = groupWords(transcript.words ?? []);
    if (!captions.length) throw new Error(`No caption timestamps returned for ${id}.`);
    scenes.push({...scene, image, audio, captions, frames: await audioFrames(audioPath)});
  }
  return {title: board.title, scenes};
}
