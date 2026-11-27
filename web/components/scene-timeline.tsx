import {MonitorPlay} from 'lucide-react';
import {memo} from 'react';
import {type DraftScene, sceneNumber, secondsFor} from '../model.ts';
import {Thumbnail} from './preview.tsx';

const TimelineItem = memo(function TimelineItem({
  scene,
  index,
  active,
  select,
}: {
  scene: DraftScene;
  index: number;
  active: boolean;
  select: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Preview scene ${index + 1}`}
      aria-pressed={active}
      className={active ? 'active' : ''}
      style={{flexGrow: secondsFor(scene)}}
      onClick={() => select(scene.id)}
    >
      <Thumbnail media={scene.media} />
      <span>{sceneNumber(index)}</span>
    </button>
  );
});

export function SceneTimeline({
  scenes,
  selectedId,
  select,
}: {
  scenes: DraftScene[];
  selectedId: string;
  select: (id: string) => void;
}) {
  return (
    <div className="timeline panel">
      <div className="timeline-head">
        <span>
          <MonitorPlay size={15} /> Scene timeline
        </span>
        <strong>
          {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
        </strong>
      </div>
      <div className="timeline-strip">
        {scenes.map((scene, i) => (
          <TimelineItem
            key={scene.id}
            scene={scene}
            index={i}
            active={scene.id === selectedId}
            select={select}
          />
        ))}
      </div>
    </div>
  );
}
