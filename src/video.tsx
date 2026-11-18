import {
  AbsoluteFill, Audio, Composition, Img, interpolate, registerRoot,
  Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import {FPS, type Project, type Scene} from './project.ts';

function Slide({scene, index}: {scene: Scene; index: number}) {
  const frame = useCurrentFrame();
  const progress = frame / scene.frames;
  const caption = scene.captions.find(({start, end}) => start <= frame / FPS && frame / FPS < end);
  const fade = Math.min(1, (frame + 1) / 5, (scene.frames - frame) / 5);
  const translate = (index % 2 ? -1 : 1) * interpolate(progress, [0, 1], [-22, 22]);
  return (
    <AbsoluteFill style={{backgroundColor: '#0b0d15', overflow: 'hidden'}}>
      <AbsoluteFill style={{opacity: fade, transform: `translateX(${translate}px) scale(${1.06 + progress * 0.12})`}}>
        {scene.image ? (
          <Img src={staticFile(scene.image)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        ) : (
          <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 39%, #03050c 11%, #241842 15%, #d47953 17%, #592f67 23%, #101731 43%, #03050c 72%)'}} />
        )}
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'linear-gradient(transparent 50%, #04050d99 77%, #04050ddd 100%)'}} />
      <Audio src={staticFile(scene.audio)} />
      {caption && (
        <div style={{
          position: 'absolute', bottom: 320, left: 90, right: 140, textAlign: 'center',
          color: '#fff', fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: 70,
          lineHeight: 1.08, textShadow: '0 4px 5px #000, 0 0 22px #000',
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
