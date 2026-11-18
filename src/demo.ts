import {copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {audioFrames, fitVideoToScene, run, toWav} from './media.ts';
import {estimatedCaptions, FPS, type Project} from './project.ts';

const shots = [
  {
    imagePrompt: 'A close three-quarter view of a black hole with a glowing asymmetric disk',
    phrases: ['Black holes are invisible.', 'So what is', 'that glowing ring?'],
  },
  {
    imagePrompt: 'A close side view of the turbulent hot gas outside the event horizon',
    clip: 'accretion-disk.mp4',
    phrases: [
      'That light comes from gas',
      'swirling outside the black hole.',
      'The gas gets so hot',
      'it starts to glow.',
    ],
  },
  {
    imagePrompt: 'Background light bent into arcs around the dark shadow by gravitational lensing',
    phrases: [
      'Gravity bends the light.',
      'It can even make gas',
      'behind the black hole',
      'appear above and below it.',
    ],
  },
  {
    imagePrompt: 'A wide field of stars surrounding the thin golden arc of a distant black hole',
    phrases: ['The glow traces its outline.', 'The black hole itself', 'stays dark.'],
  },
];

export async function demoProject(assets: string, suppliedMusic?: Project['music']): Promise<Project> {
  const scenes: Project['scenes'] = [];

  for (const [index, {imagePrompt, phrases, clip}] of shots.entries()) {
    const id = `scene-${index + 1}`;
    const audio = `${id}.wav`;
    const wav = join(assets, audio);
    const narration = phrases.join(' ');
    await toWav(fileURLToPath(new URL(`../demo/${id}.flac`, import.meta.url)), wav);

    const frames = await audioFrames(wav);
    const captions = estimatedCaptions(phrases, frames);
    if (clip) {
      const video = `${id}.mp4`;
      await fitVideoToScene(
        fileURLToPath(new URL(`../demo/${clip}`, import.meta.url)),
        join(assets, video),
        frames,
      );
      scenes.push({narration, audio, frames, captions, video});
    } else {
      const image = `${id}.jpg`;
      await copyFile(new URL(`../demo/${image}`, import.meta.url), join(assets, image));
      scenes.push({narration, audio, frames, captions, imagePrompt, image});
    }
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
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=${pad}:s=48000:d=${length}`,
      join(assets, 'music.wav'),
    ]);
  }

  return {title: 'Why do black holes look bright?', scenes, music: 'music.wav'};
}
