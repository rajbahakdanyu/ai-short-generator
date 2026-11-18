import {copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {audioFrames, run, toWav} from './media.ts';
import {FPS, type Project} from './project.ts';

const shots = [
  {
    imagePrompt: 'A close three-quarter view of a black hole with a glowing asymmetric disk',
    phrases: ['Black holes are invisible.', 'So what is', 'that glowing ring?'],
  },
  {
    imagePrompt: 'A close side view of the turbulent hot gas outside the event horizon',
    phrases: ['That light comes from gas', 'swirling outside the black hole.', 'The gas gets so hot', 'it starts to glow.'],
  },
  {
    imagePrompt: 'Background light bent into arcs around the dark shadow by gravitational lensing',
    phrases: ['Gravity bends the light.', 'It can even make gas', 'behind the black hole', 'appear above and below it.'],
  },
  {
    imagePrompt: 'A wide field of stars surrounding the thin golden arc of a distant black hole',
    phrases: ['The glow traces its outline.', 'The black hole itself', 'stays dark.'],
  },
];

export async function demoProject(assets: string, suppliedMusic?: Project['music']): Promise<Project> {
  const scenes: Project['scenes'] = [];

  for (const [index, {imagePrompt, phrases}] of shots.entries()) {
    const id = `scene-${index + 1}`;
    const image = `${id}.jpg`;
    const audio = `${id}.wav`;
    const wav = join(assets, audio);
    const narration = phrases.join(' ');
    await copyFile(new URL(`../demo/${image}`, import.meta.url), join(assets, image));
    await toWav(fileURLToPath(new URL(`../demo/${id}.flac`, import.meta.url)), wav);

    const frames = await audioFrames(wav);
    // Weight phrases by length and allow extra time for spoken pauses.
    const weights = phrases.map((phrase) => phrase.length + (/[.!?]$/.test(phrase) ? 8 : 0));
    const secondsPerWeight = (frames - 3) / FPS / weights.reduce((sum, weight) => sum + weight, 0);
    let time = 0;
    const captions = phrases.map((text, i) => {
      const start = time;
      time += weights[i] * secondsPerWeight;
      return {text, start, end: time};
    });
    scenes.push({narration, audio, frames, captions, imagePrompt, image});
  }

  if (!suppliedMusic) {
    const length = scenes.reduce((sum, scene) => sum + scene.frames, 0) / FPS;
    // A low drone, a beating fifth, and a soft higher swell.
    const pad = [
      '0.32*sin(2*PI*55*t)',
      '0.24*sin(2*PI*82.41*t)*(0.65+0.35*sin(2*PI*0.27*t))',
      '0.12*sin(2*PI*110.2*t)',
      '0.08*sin(2*PI*164.81*t)*(0.5+0.5*sin(2*PI*0.19*t))',
    ].join('+');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi',
      '-i', `aevalsrc=${pad}:s=48000:d=${length}`, join(assets, 'music.wav'),
    ]);
  }

  return {title: 'Why do black holes look bright?', scenes, music: 'music.wav'};
}
