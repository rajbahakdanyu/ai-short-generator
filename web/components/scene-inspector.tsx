import {ActionIcon, Button, Menu, NumberInput, Select, Textarea, TextInput} from '@mantine/core';
import {ArrowDown, ArrowUp, AudioLines, Check, Film, Mic, MoreHorizontal, Trash2, Upload} from 'lucide-react';
import {useRef, useState} from 'react';
import {errorMessage} from '../../src/errors.ts';
import {defaultKokoroVoice, isKokoroVoice, kokoroVoices} from '../../src/kokoro-voices.ts';
import {FPS, maxSceneFrames} from '../../src/project.ts';
import {audioDuration} from '../assets.ts';
import {type DraftScene, framesFor, sceneNumber} from '../model.ts';
import {newRecording} from '../scene-state.ts';
import {CaptionEditor} from './caption-editor.tsx';
import {Thumbnail} from './preview.tsx';

const voiceOptions = Object.entries(kokoroVoices).map(([value, label]) => ({value, label}));

function SceneActions({
  index,
  total,
  move,
  remove,
}: {
  index: number;
  total: number;
  move: (delta: number) => void;
  remove: () => void;
}) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Scene actions">
          <MoreHorizontal size={17} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item disabled={index === 0} leftSection={<ArrowUp size={15} />} onClick={() => move(-1)}>
          Move up
        </Menu.Item>
        <Menu.Item
          disabled={index === total - 1}
          leftSection={<ArrowDown size={15} />}
          onClick={() => move(1)}
        >
          Move down
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item disabled={total === 1} color="red" leftSection={<Trash2 size={15} />} onClick={remove}>
          Delete scene
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function VisualField({
  scene,
  patch,
  setError,
}: {
  scene: DraftScene;
  patch: (patch: Partial<DraftScene>) => void;
  setError: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  function choose(file?: File) {
    if (!file) return;
    const video = file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
    if (!video && !file.type.startsWith('image/')) {
      setError('Choose an image or an MP4 clip.');
      return;
    }
    setError('');
    patch({media: {name: file.name, kind: video ? 'video' : 'image', source: file}});
  }

  return (
    <div className="field-block">
      <div className="field-title">
        <span>
          <Film size={15} /> Visual
        </span>
        {scene.media && (
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => picker.current?.click()}>
            Replace
          </Button>
        )}
      </div>
      <button
        className={`upload-target ${dragging ? 'dragging' : ''}`}
        type="button"
        onClick={() => picker.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files[0]);
        }}
      >
        {scene.media ? (
          <Thumbnail media={scene.media} />
        ) : (
          <span className="icon-tile">
            <Upload size={17} />
          </span>
        )}
        <span>
          <strong>{scene.media?.name ?? 'Choose or drop a file'}</strong>
          <small>
            {scene.media?.kind === 'video' ? 'MP4 clip' : scene.media ? 'Still image' : 'Image or MP4'}
          </small>
        </span>
      </button>
      <input
        type="file"
        hidden
        ref={picker}
        accept="image/*,video/mp4,.mp4"
        aria-label="Scene visual file"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function SceneInspector({
  scene,
  index,
  total,
  patchScene,
  moveScene,
  removeScene,
  voiceBusy,
  voiceLoading,
  generateVoice,
  setError,
}: {
  scene: DraftScene;
  index: number;
  total: number;
  patchScene: (id: string, patch: Partial<DraftScene>) => void;
  moveScene: (delta: number) => void;
  removeScene: () => void;
  voiceBusy: boolean;
  voiceLoading: boolean;
  generateVoice: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const narrationPicker = useRef<HTMLInputElement>(null);
  const patch = (update: Partial<DraftScene>) => patchScene(scene.id, update);

  async function replaceNarration(file?: File) {
    if (
      !file ||
      (scene.captions && !window.confirm('Replacing narration resets edited caption timings. Continue?'))
    )
      return;
    try {
      const seconds = await audioDuration(file);
      if (seconds > 119) throw new Error('Narration must be shorter than two minutes.');
      patch(newRecording({name: file.name, kind: 'audio', source: file}, seconds));
    } catch (issue) {
      setError(errorMessage(issue));
    }
  }

  return (
    <section className="panel inspector" aria-label="Scene settings">
      <div className="panel-heading">
        <div>
          <span className="inspector-number">{sceneNumber(index)}</span> <h2>Scene details</h2>
        </div>
        <SceneActions index={index} total={total} move={moveScene} remove={removeScene} />
      </div>
      <div className="inspector-body">
        <TextInput
          label="Scene name"
          value={scene.name}
          maxLength={85}
          onChange={(event) => patch({name: event.currentTarget.value})}
        />
        <VisualField scene={scene} patch={patch} setError={setError} />
        <Textarea
          label="Visual prompt"
          value={scene.imagePrompt ?? ''}
          maxLength={4000}
          minRows={2}
          maxRows={5}
          autosize
          onChange={(event) => patch({imagePrompt: event.currentTarget.value || undefined})}
        />
        <div className="field-block narration">
          <Textarea
            label={
              <span className="field-label">
                <Mic size={15} /> Narration
              </span>
            }
            placeholder="Type the words you want spoken…"
            value={scene.narration}
            minRows={4}
            autosize
            maxRows={8}
            maxLength={4000}
            onChange={(event) => patch({narration: event.currentTarget.value, voiceOutdated: !!scene.voice})}
          />
          <Select
            mt="xs"
            label="Local voice"
            data={voiceOptions}
            value={scene.kokoroVoice ?? defaultKokoroVoice}
            allowDeselect={false}
            onChange={(voice) => {
              if (!voice || !isKokoroVoice(voice) || voice === (scene.kokoroVoice ?? defaultKokoroVoice))
                return;
              patch({kokoroVoice: voice, voiceOutdated: !!scene.voice});
            }}
          />
          <div className="narration-actions">
            <span>
              {scene.voiceOutdated ? (
                'Voice outdated'
              ) : scene.voice ? (
                <>
                  <Check size={13} /> Voice ready
                </>
              ) : (
                'Voice pending'
              )}
            </span>
            <Button
              loading={voiceLoading}
              disabled={!scene.narration.trim() || voiceBusy}
              leftSection={<AudioLines size={14} />}
              size="compact-sm"
              variant="default"
              onClick={() => {
                if (
                  !scene.captions ||
                  window.confirm('Regenerating voice resets edited caption timings. Continue?')
                )
                  void generateVoice();
              }}
            >
              {scene.voice ? 'Regenerate voice' : 'Generate voice'}
            </Button>
          </div>
        </div>
        <Textarea
          label="Sources and verification notes"
          placeholder="Add references and note claims to verify"
          value={scene.sources ?? ''}
          maxLength={4000}
          onChange={(event) => patch({sources: event.currentTarget.value})}
        />
        <NumberInput
          label="Scene duration (seconds)"
          disabled={scene.voiceOutdated}
          description={scene.voiceOutdated ? 'Duration will be set from the new recording.' : undefined}
          min={1}
          hideControls
          max={maxSceneFrames / FPS}
          value={framesFor(scene) / FPS}
          decimalScale={2}
          onChange={(value) => {
            if (typeof value === 'number' && value >= 1 && value <= maxSceneFrames / FPS) {
              const frames = Math.round(value * FPS);
              patch({frames, seconds: frames / FPS});
            }
          }}
        />
        <div>
          <Button
            type="button"
            size="compact-sm"
            variant="default"
            leftSection={<Upload size={15} />}
            disabled={voiceBusy}
            onClick={() => narrationPicker.current?.click()}
          >
            Upload replacement narration
          </Button>
          <input
            type="file"
            hidden
            ref={narrationPicker}
            accept="audio/*"
            disabled={voiceBusy}
            aria-label="Upload replacement narration"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void replaceNarration(file);
            }}
          />
        </div>
        <CaptionEditor scene={scene} patch={patch} setError={setError} />
      </div>
    </section>
  );
}
