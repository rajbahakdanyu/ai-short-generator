import {Composition, registerRoot} from 'remotion';
import {Short, shortHeight, shortWidth} from './composition.tsx';
import {FPS} from './timing.ts';

registerRoot(() => (
  <Composition
    id="EducationalShort"
    component={Short}
    width={shortWidth}
    height={shortHeight}
    fps={FPS}
    durationInFrames={FPS}
    defaultProps={{scenes: []}}
    calculateMetadata={({props}) => ({
      durationInFrames: Math.max(
        1,
        props.scenes.reduce((sum, scene) => sum + scene.frames, 0),
      ),
    })}
  />
));
