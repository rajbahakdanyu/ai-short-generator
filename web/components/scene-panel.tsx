import {ActionIcon, Button, NumberInput, Tooltip} from '@mantine/core';
import {Film, Image as ImageIcon, Layers, Music2, Plus, X} from 'lucide-react';
import {memo, useRef} from 'react';
import {type Asset, type Draft, type DraftScene, sceneNumber, secondsFor} from '../model.ts';
import {Thumbnail} from './preview.tsx';

const SceneRow = memo(function SceneRow({
  scene,
  index,
  selected,
  select,
}: {
  scene: DraftScene;
  index: number;
  selected: boolean;
  select: (id: string) => void;
}) {
  const video = scene.media?.kind === 'video';
  return (
    <button
      type="button"
      className={`scene-row ${selected ? 'selected' : ''}`}
      onClick={() => select(scene.id)}
      aria-pressed={selected}
    >
      <Thumbnail media={scene.media} />
      <span className="row-content">
        <span className="row-title">
          <span className="row-index">{sceneNumber(index)}</span>
          {scene.name}
        </span>
        <span className="row-copy">{scene.narration || 'Add narration'}</span>
        <span className="row-meta">
          {video ? <Film size={12} /> : <ImageIcon size={12} />}
          {video ? 'Video' : scene.media ? 'Image' : 'No visual'} <span>·</span>{' '}
          {secondsFor(scene).toFixed(1)}s
        </span>
      </span>
    </button>
  );
});

function Soundtrack({
  music,
  volume = 0.13,
  setDraft,
}: {
  music?: Asset;
  volume?: number;
  setDraft: (update: (draft: Draft) => Draft) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="music-box">
      <div className="icon-tile">
        <Music2 size={17} />
      </div>
      <div>
        <strong>Soundtrack</strong>
        <span>{music?.name ?? 'Optional background audio'}</span>
      </div>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={music ? 'Remove soundtrack' : 'Upload soundtrack'}
        onClick={() =>
          music ? setDraft((current) => ({...current, music: undefined})) : picker.current?.click()
        }
      >
        {music ? <X size={16} /> : <Plus size={17} />}
      </ActionIcon>
      {music && (
        <NumberInput
          label="Soundtrack volume (%)"
          min={0}
          hideControls
          max={100}
          value={Math.round(volume * 100)}
          onChange={(value) => {
            if (typeof value === 'number' && value >= 0 && value <= 100)
              setDraft((current) => ({...current, musicVolume: value / 100}));
          }}
        />
      )}
      <input
        type="file"
        accept="audio/*"
        hidden
        ref={picker}
        aria-label="Soundtrack file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            setDraft((current) => ({...current, music: {name: file.name, kind: 'audio', source: file}}));
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function ScenePanel({
  draft,
  selectedId,
  select,
  addScene,
  setDraft,
}: {
  draft: Draft;
  selectedId: string;
  select: (id: string) => void;
  addScene: () => void;
  setDraft: (update: (draft: Draft) => Draft) => void;
}) {
  return (
    <section className="panel scene-panel" aria-label="Storyboard scenes">
      <div className="panel-heading">
        <div>
          <Layers size={16} /> <h2>Scenes</h2> <span className="count">{draft.scenes.length}</span>
        </div>
        <Tooltip label="Add scene">
          <ActionIcon variant="default" aria-label="Add scene" onClick={addScene}>
            <Plus size={17} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="scene-list">
        {draft.scenes.map((scene, i) => (
          <SceneRow
            key={scene.id}
            scene={scene}
            index={i}
            selected={scene.id === selectedId}
            select={select}
          />
        ))}
        <Button
          fullWidth
          variant="subtle"
          color="gray"
          className="add-scene"
          leftSection={<Plus size={15} />}
          onClick={addScene}
        >
          Add scene
        </Button>
      </div>
      <Soundtrack music={draft.music} volume={draft.musicVolume} setDraft={setDraft} />
    </section>
  );
}
