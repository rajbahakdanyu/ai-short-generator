import {
  AbsoluteFill, Audio, Composition, Img, interpolate, OffthreadVideo, registerRoot,
  Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import {FPS, type Project, type Scene} from './project.ts';

function Slide({scene, index}: {scene: Scene; index: number}) {
  const frame = useCurrentFrame();
  const progress = frame / scene.frames;
  const caption = scene.captions.find(({start, end}) => start <= frame / FPS && frame / FPS < end);
  const captionAge = caption ? Math.max(0, frame - caption.start * FPS) : 0;
  const captionRise = interpolate(captionAge, [0, 4], [10, 0], {extrapolateRight: 'clamp'});
  const pushIn = index % 2 === 0;
  const scale = interpolate(progress, [0, 1], pushIn ? [1.05, 1.18] : [1.18, 1.05]);
  const translate = interpolate(progress, [0, 1], pushIn ? [-20, 12] : [20, -12]);
  return (
    <AbsoluteFill style={{backgroundColor: '#0b0d15', overflow: 'hidden'}}>
      {scene.video ? (
        <OffthreadVideo muted src={staticFile(scene.video)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      ) : (
        <AbsoluteFill style={{transform: `translateX(${translate}px) scale(${scale})`}}>
          {scene.image ? (
            <Img src={staticFile(scene.image)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 39%, #03050c 11%, #241842 15%, #d47953 17%, #592f67 23%, #101731 43%, #03050c 72%)'}} />
          )}
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{background: 'linear-gradient(transparent 47%, #04050d60 70%, #04050de8 100%)'}} />
      <Audio src={staticFile(scene.audio)} />
      {caption && (
        <div style={{
          position: 'absolute', bottom: 352, left: 80, right: 144, textAlign: 'left',
          color: index === 0 ? '#ffdfa0' : '#fff', fontFamily: 'Helvetica Neue, Arial, sans-serif',
          fontWeight: 850, fontSize: index === 0 ? 87 : 74, letterSpacing: -2,
          lineHeight: 1.02, textWrap: 'balance', textShadow: '0 3px 10px #03050c, 0 0 28px #03050c',
          transform: `translateY(${captionRise}px)`,
        }}>
          {caption.text}
        </div>
      )}
    </AbsoluteFill>
  );
}

function Short({scenes, music}: Project) {
  const {durationInFrames} = useVideoConfig();
  let start = 0;
  return (
    <AbsoluteFill>
      {music && <Audio src={staticFile(music)} loop loopVolumeCurveBehavior="extend" volume={(frame) => (
        0.13 * Math.max(0, Math.min(1, frame / 15, (durationInFrames - frame) / 24))
      )} />}
      {scenes.map((scene, index) => {
        const from = start;
        start += scene.frames;
        return (
          <Sequence key={scene.audio} from={from} durationInFrames={scene.frames}>
            <Slide scene={scene} index={index} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

registerRoot(() => (
  <Composition
    id="EducationalShort"
    component={Short}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={FPS}
    defaultProps={{title: '', scenes: []}}
    calculateMetadata={({props}) => ({
      durationInFrames: Math.max(1, props.scenes.reduce((sum, scene) => sum + scene.frames, 0)),
    })}
  />
));
