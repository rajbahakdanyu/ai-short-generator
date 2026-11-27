import {ActionIcon, Button, Menu, NumberInput, Select, Textarea, TextInput} from '@mantine/core';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Film,
  Mic,
  MoreHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import {useRef, useState} from 'react';
import {defaultKokoroVoice, isKokoroVoice, kokoroVoices} from '../src/kokoro-voices.ts';
import {captionIssue, FPS, maxCaptions, maxSceneFrames} from '../src/project.ts';
import {captionsFor, type DraftScene, framesFor} from './model.ts';
import {Thumbnail} from './preview.tsx';
import {newRecording} from './scene-state.ts';

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
  const [dragging, setDragging] = useState(false);
  const visualPicker = useRef<HTMLInputElement>(null);
  function chooseVisual(file?: File) {
    if (!file) return;
    const video = file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
    if (!video && !file.type.startsWith('image/')) {
      setError('Choose an image or an MP4 clip.');
      return;
    }
    setError('');
    patchScene(scene.id, {media: {name: file.name, kind: video ? 'video' : 'image', source: file}});
  }

  return (
    <section className="panel inspector" aria-label="Scene settings">
      <div className="panel-heading">
        <div>
          <span className="inspector-number">{String(index + 1).padStart(2, '0')}</span>{' '}
          <h2>Scene details</h2>
        </div>
        <SceneActions index={index} total={total} move={moveScene} remove={removeScene} />
      </div>
      <div className="inspector-body">
        <TextInput
          label="Scene name"
          value={scene.name}
          maxLength={85}
          onChange={(event) => patchScene(scene.id, {name: event.currentTarget.value})}
        />
        <div className="field-block">
          <div className="field-title">
            <span>
              <Film size={15} /> Visual
            </span>
            {scene.media && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => visualPicker.current?.click()}
              >
                Replace
              </Button>
            )}
          </div>
          <button
            className={`upload-target ${dragging ? 'dragging' : ''}`}
            type="button"
            onClick={() => visualPicker.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseVisual(event.dataTransfer.files[0]);
            }}
          >
            {scene.media ? (
              <Thumbnail scene={scene} />
            ) : (
              <span className="upload-icon">
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
            ref={visualPicker}
            accept="image/*,video/mp4,.mp4"
            aria-label="Scene visual file"
            onChange={(event) => {
              chooseVisual(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        <Textarea
          label="Visual prompt"
          value={scene.imagePrompt ?? ''}
          maxLength={4000}
          minRows={2}
          maxRows={5}
          autosize
          onChange={(event) => patchScene(scene.id, {imagePrompt: event.currentTarget.value || undefined})}
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
            onChange={(event) =>
              patchScene(scene.id, {
                narration: event.currentTarget.value,
                voiceOutdated: !!scene.voice,
              })
            }
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
              patchScene(scene.id, {
                kokoroVoice: voice,
                voiceOutdated: !!scene.voice,
              });
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
          onChange={(event) => patchScene(scene.id, {sources: event.currentTarget.value})}
        />
        <NumberInput
          label="Scene duration (seconds)"
          disabled={scene.voiceOutdated}
          description={scene.voiceOutdated ? 'Duration will be set from the new recording.' : undefined}
          min={1}
          max={maxSceneFrames / FPS}
          value={framesFor(scene) / FPS}
          decimalScale={2}
          onChange={(value) => {
            if (typeof value === 'number' && value >= 1 && value <= maxSceneFrames / FPS) {
              const frames = Math.round(value * FPS);
              patchScene(scene.id, {frames, seconds: frames / FPS});
            }
          }}
        />
        <input
          type="file"
          accept="audio/*"
          disabled={voiceBusy}
          aria-label="Upload replacement narration"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (
              !file ||
              (scene.captions &&
                !window.confirm('Replacing narration resets edited caption timings. Continue?'))
            )
              return;
            const context = new AudioContext();
            try {
              const seconds = (await context.decodeAudioData(await file.arrayBuffer())).duration;
              if (seconds > 119) throw new Error('Narration must be shorter than two minutes.');
              patchScene(scene.id, newRecording({name: file.name, kind: 'audio', source: file}, seconds));
            } catch (issue) {
              setError(String(issue));
            } finally {
              await context.close();
            }
          }}
        />
        <details className="caption-panel">
          <summary>
            Captions{' '}
            <span>
              {captionsFor(scene).length} cues <ChevronDown size={13} />
            </span>
          </summary>
          {(!scene.voice || scene.voiceOutdated) && <p>Generate narration before editing caption timing.</p>}
          {scene.voice &&
            !scene.voiceOutdated &&
            captionsFor(scene).map((cue, i, cues) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Caption slots stay in order, and their text and timing are editable.
              <div className="caption-edit" key={i}>
                <TextInput
                  aria-label={`Caption ${i + 1}`}
                  value={cue.text}
                  error={!cue.text.trim()}
                  onChange={(event) => {
                    const text = event.currentTarget.value;
                    patchScene(scene.id, {
                      captions: cues.map((item, j) => (j === i ? {...item, text} : item)),
                    });
                  }}
                />
                <div>
                  {(['start', 'end'] as const).map((edge) => (
                    <NumberInput
                      key={edge}
                      label={edge === 'start' ? 'Start (s)' : 'End (s)'}
                      aria-label={`Caption ${i + 1} ${edge}`}
                      error={edge === 'end' ? captionIssue(cues, i, framesFor(scene)) : undefined}
                      decimalScale={2}
                      step={0.05}
                      min={0}
                      max={framesFor(scene) / FPS}
                      value={cue[edge]}
                      onChange={(value) => {
                        if (typeof value === 'number')
                          patchScene(scene.id, {
                            captions: cues.map((item, j) => (j === i ? {...item, [edge]: value} : item)),
                          });
                      }}
                    />
                  ))}
                </div>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => patchScene(scene.id, {captions: cues.filter((_, j) => j !== i)})}
                >
                  Delete cue
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={cues.length >= maxCaptions || cue.text.trim().split(/\s+/).length < 2}
                  onClick={() => {
                    const middle = (cue.start + cue.end) / 2;
                    const words = cue.text.trim().split(/\s+/);
                    const split = Math.ceil(words.length / 2);
                    patchScene(scene.id, {
                      captions: [
                        ...cues.slice(0, i),
                        {...cue, end: middle, text: words.slice(0, split).join(' ')},
                        {...cue, start: middle, text: words.slice(split).join(' ')},
                        ...cues.slice(i + 1),
                      ],
                    });
                  }}
                >
                  Split cue
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={!cues[i + 1]}
                  onClick={() => {
                    const next = cues[i + 1];
                    patchScene(scene.id, {
                      captions: [
                        ...cues.slice(0, i),
                        {...cue, end: next.end, text: `${cue.text} ${next.text}`},
                        ...cues.slice(i + 2),
                      ],
                    });
                  }}
                >
                  Merge with next
                </Button>
              </div>
            ))}
          {scene.voice && !scene.voiceOutdated && (
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={captionsFor(scene).length >= maxCaptions}
              onClick={() => {
                const cues = captionsFor(scene);
                const end = framesFor(scene) / FPS;
                const start = cues.at(-1)?.end ?? 0;
                if (start >= end) {
                  setError('Shorten the last cue to make room for a new one.');
                  return;
                }
                patchScene(scene.id, {captions: [...cues, {start, end, text: 'New caption'}]});
              }}
            >
              Add cue
            </Button>
          )}
        </details>
      </div>
    </section>
  );
}
