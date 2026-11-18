import {createReadStream} from 'node:fs';
import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import OpenAI from 'openai';
import {zodTextFormat} from 'openai/helpers/zod';
import {z} from 'zod';
import {FPS, groupWords, type Project} from './project.ts';
import {run, toWav, audioFrames} from './media.ts';

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
      'Hook the viewer immediately, explain one idea clearly, and end with a memorable payoff.',
      'Use accurate established facts and qualify uncertainty. Do not invent statistics or citations.',
      'Write natural spoken narration without markup, production notes, or headings.',
      'Give each scene a distinct, self-contained image prompt with a consistent visual motif and palette.',
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

export async function demoProject(assets: string): Promise<Project> {
  const lines = [
    'What would you see if you looked directly at a black hole?',
    'The black hole itself is dark. Light cannot escape once it crosses the event horizon.',
    'Some black holes shine indirectly. Hot gas outside the horizon can glow as it spirals inward.',
  ];
  const scenes: Project['scenes'] = [];
  for (const [index, narration] of lines.entries()) {
    const audio = `scene-${index + 1}.wav`;
    const aiff = join(assets, `scene-${index + 1}.aiff`);
    const wav = join(assets, audio);
    await run('say', ['-o', aiff, narration]);
    await toWav(aiff, wav);
    await rm(aiff);
    const frames = await audioFrames(wav);
    const words = narration.split(' ');
    const step = (frames - 3) / (FPS * words.length);
    const captions = groupWords(words.map((word, i) => ({
      word, start: i * step, end: (i + 1) * step,
    })));
    scenes.push({narration, audio, frames, captions, imagePrompt: 'Abstract black hole illustration'});
  }
  return {title: 'Why black holes can look bright', scenes};
}
