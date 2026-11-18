import {useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  Html5Video,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {FPS, type Scene} from './project.ts';

type PlaybackScene = Omit<Scene, 'audio'> & {audio?: string};
export type PlaybackProps = {
  scenes: PlaybackScene[];
  music?: string;
  musicVolume?: number;
  preview?: boolean;
  firstIndex?: number;
  showCaptions?: boolean;
};
export const shortWidth = 1080;
export const shortHeight = 1920;

function Slide({
  scene,
  index,
  preview,
  showCaptions,
}: {
  scene: PlaybackScene;
  index: number;
  preview?: boolean;
  showCaptions?: boolean;
}) {
  const [mediaError, setMediaError] = useState<Error>();
  if (mediaError) throw mediaError;
  const onError = preview ? setMediaError : undefined;
  const asset = preview ? (url: string) => url : staticFile;
  const frame = useCurrentFrame();
  const progress = frame / scene.frames;
  const caption = scene.captions.find(({start, end}) => start <= frame / FPS && frame / FPS < end);
  const captionAge = caption ? Math.max(0, frame - caption.start * FPS) : 0;
  const captionRise = interpolate(captionAge, [0, 4], [10, 0], {extrapolateRight: 'clamp'});
  const pushIn = index % 2 === 0;
  const scale = interpolate(progress, [0, 1], pushIn ? [1.05, 1.18] : [1.18, 1.05]);
  const translate = interpolate(progress, [0, 1], pushIn ? [-20, 12] : [20, -12]);
  const Video = preview ? Html5Video : OffthreadVideo;
  return (
    <AbsoluteFill style={{backgroundColor: '#0b0d15', overflow: 'hidden'}}>
      {scene.video ? (
        <Video
          muted
          loop={preview}
          onError={onError}
          src={asset(scene.video)}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      ) : (
        <AbsoluteFill style={{transform: `translateX(${translate}px) scale(${scale})`}}>
          {scene.image ? (
            <Img src={asset(scene.image)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            <AbsoluteFill
              style={{
                background:
                  'radial-gradient(ellipse at 50% 39%, #03050c 11%, #241842 15%, #d47953 17%, #592f67 23%, #101731 43%, #03050c 72%)',
              }}
            />
          )}
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{background: 'linear-gradient(transparent 47%, #04050d60 70%, #04050de8 100%)'}} />
      {scene.audio && <Audio src={asset(scene.audio)} onError={onError} />}
      {showCaptions !== false && caption && (
        <div
          style={{
            position: 'absolute',
            bottom: 352,
            left: 80,
            right: 144,
            textAlign: 'left',
            color: index === 0 ? '#ffdfa0' : '#fff',
            fontFamily: 'Helvetica Neue, Arial, sans-serif',
            fontWeight: 850,
            fontSize: index === 0 ? 87 : 74,
            letterSpacing: -2,
            lineHeight: 1.02,
            textWrap: 'balance',
            textShadow: '0 3px 10px #03050c, 0 0 28px #03050c',
            transform: `translateY(${captionRise}px)`,
          }}
        >
          {caption.text}
        </div>
      )}
    </AbsoluteFill>
  );
}

export function Short({
  scenes,
  music,
  musicVolume = 0.13,
  preview,
  firstIndex = 0,
  showCaptions,
}: PlaybackProps) {
  const {durationInFrames} = useVideoConfig();
  const [musicError, setMusicError] = useState<Error>();
  if (musicError) throw musicError;
  let start = 0;
  return (
    <AbsoluteFill>
      {music && (
        <Audio
          src={preview ? music : staticFile(music)}
          onError={preview ? setMusicError : undefined}
          loop
          loopVolumeCurveBehavior="extend"
          volume={(frame) =>
            musicVolume * Math.max(0, Math.min(1, frame / 15, (durationInFrames - frame) / 24))
          }
        />
      )}
      {scenes.map((scene, index) => {
        const from = start;
        start += scene.frames;
        return (
          <Sequence key={`${from}-${scene.audio ?? 'silent'}`} from={from} durationInFrames={scene.frames}>
            <Slide scene={scene} index={index + firstIndex} preview={preview} showCaptions={showCaptions} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
