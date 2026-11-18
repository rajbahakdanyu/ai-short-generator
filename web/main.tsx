import '@mantine/core/styles.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './studio.css';
import {
  ActionIcon,
  Alert,
  Button,
  createTheme,
  MantineProvider,
  Menu,
  Modal,
  NumberInput,
  Progress,
  Select,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {get, set} from 'idb-keyval';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Clapperboard,
  ClipboardPaste,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Layers,
  Mic,
  MonitorPlay,
  MoreHorizontal,
  Music2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {defaultKokoroVoice, isKokoroVoice, kokoroVoices} from '../src/kokoro-voices.ts';
import type {PaidSelection} from '../src/providers/catalog.ts';
import {
  type Asset,
  api,
  assetBlob,
  captionsFor,
  type Draft,
  type DraftScene,
  formatTime,
  freshScene,
  type Job,
  sampleDraft,
  secondsFor,
} from './model.ts';
import type {PaidInput} from './paid-dialog.tsx';
import {Preview, Thumbnail} from './preview.tsx';

const PaidDialog = lazy(async () => ({default: (await import('./paid-dialog.tsx')).PaidDialog}));
const key = 'short-studio-draft';
const voiceOptions = Object.entries(kokoroVoices).map(([value, label]) => ({value, label}));
const lastJobKey = 'short-studio-last-job';
const theme = createTheme({
  fontFamily: 'Inter Variable, system-ui, sans-serif',
  defaultRadius: 'md',
  respectReducedMotion: true,
});

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

function Studio() {
  const [draft, setDraft] = useState<Draft>(sampleDraft);
  const [selectedId, setSelectedId] = useState(sampleDraft.scenes[0].id);
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [error, setError] = useState('');
  const [voiceScene, setVoiceScene] = useState<string>();
  const [dialog, setDialog] = useState<'script' | 'new' | 'sample' | 'export' | 'paid' | 'import'>();
  const [paidSelection, setPaidSelection] = useState<PaidSelection>({});
  const [script, setScript] = useState('');
  const [job, setJob] = useState<Job | undefined>(() => {
    try {
      const id = sessionStorage.getItem(lastJobKey);
      if (id) return {id, phase: 'Preparing scenes', progress: 0};
    } catch {
      // The editor still works if browser storage is unavailable.
    }
  });
  const [incoming, setIncoming] = useState<Draft>();
  const [opening, setOpening] = useState(false);
  const folderPicker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const visualPicker = useRef<HTMLInputElement>(null);
  const musicPicker = useRef<HTMLInputElement>(null);
  const index = Math.max(
    0,
    draft.scenes.findIndex((s) => s.id === selectedId),
  );
  const scene = draft.scenes[index];
  const running = !!job && job.phase !== 'Complete' && job.phase !== 'Failed';
  const totalSeconds = draft.scenes.reduce((sum, s) => sum + secondsFor(s), 0);
  const invalidCaptions = draft.scenes.some((s) =>
    s.captions?.some((cue) => !cue.text.trim() || cue.end <= cue.start),
  );
  const ready =
    !!draft.title.trim() && !invalidCaptions && draft.scenes.every((s) => s.narration.trim() && s.media);
  const videoUrl =
    job?.id && job.hasVideo && job.phase === 'Complete' ? `/api/studio/jobs/${job.id}/video` : undefined;

  useEffect(() => {
    let active = true;
    void get<Draft>(key)
      .then((saved) => {
        if (active && saved?.scenes.length) {
          setDraft(saved);
          setSelectedId(saved.scenes[0].id);
        }
      })
      .catch(() => {
        if (active) setSaveError(true);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const save = setTimeout(() => {
      void set(key, draft)
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    }, 250);
    return () => clearTimeout(save);
  }, [draft, hydrated]);

  useEffect(() => {
    if (!job?.id) return;
    try {
      sessionStorage.setItem(lastJobKey, job.id);
    } catch {
      // Export files are still stored on disk.
    }
  }, [job?.id]);

  const pollId = job?.id;
  useEffect(() => {
    if (!pollId || !running) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const progress: Job = await (await api(`jobs/${pollId}`)).json();
        if (!active) return;
        setJob({...progress, id: pollId});
        if (progress.phase !== 'Complete' && progress.phase !== 'Failed') timer = setTimeout(poll, 500);
      } catch (issue) {
        if (active) setJob({phase: 'Failed', progress: 0, error: String(issue)});
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pollId, running]);

  function patchScene(id: string, patch: Partial<DraftScene>) {
    setDraft((current) => ({
      ...current,
      scenes: current.scenes.map((s) => (s.id === id ? {...s, ...patch} : s)),
    }));
  }

  function moveScene(delta: number) {
    setDraft((current) => {
      const scenes = [...current.scenes];
      const from = scenes.findIndex((s) => s.id === scene.id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= scenes.length) return current;
      [scenes[from], scenes[to]] = [scenes[to], scenes[from]];
      return {...current, scenes};
    });
  }

  function addScene() {
    const next = freshScene();
    setDraft((current) => ({
      ...current,
      scenes: [...current.scenes, {...next, name: `Scene ${current.scenes.length + 1}`}],
    }));
    setSelectedId(next.id);
  }

  function importScript() {
    const paragraphs = script
      .trim()
      .split(/\r?\n\s*\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!paragraphs.length) return;
    const scenes = paragraphs.map((part, i) => ({...freshScene(part), name: `Scene ${i + 1}`}));
    setDraft((current) => ({...current, scenes}));
    setSelectedId(scenes[0].id);
    setDialog(undefined);
    setScript('');
  }

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

  async function generateVoice() {
    const {id, narration} = scene;
    const kokoroVoice = scene.kokoroVoice ?? defaultKokoroVoice;
    setVoiceScene(id);
    setError('');
    try {
      const response = await api('voice', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Short-Studio': '1'},
        body: JSON.stringify({narration, kokoroVoice}),
      });
      const source = await response.blob();
      const context = new AudioContext();
      let seconds: number;
      try {
        seconds = (await context.decodeAudioData(await source.arrayBuffer())).duration;
      } finally {
        await context.close();
      }
      const voice: Asset = {name: kokoroVoices[kokoroVoice], kind: 'audio', source};
      setDraft((current) => ({
        ...current,
        scenes: current.scenes.map((s) =>
          s.id === id && s.narration === narration && (s.kokoroVoice ?? defaultKokoroVoice) === kokoroVoice
            ? {...s, voice, seconds, frames: undefined, kokoroVoice}
            : s,
        ),
      }));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setVoiceScene(undefined);
    }
  }

  async function exportVideo() {
    if (!ready || running || voiceScene) return;
    setJob({phase: 'Uploading media', progress: 0});
    setDialog('export');
    try {
      const form = new FormData();
      form.set(
        'storyboard',
        JSON.stringify({
          title: draft.title,
          scenes: draft.scenes.map((scene) => ({
            narration: scene.narration,
            kokoroVoice: scene.kokoroVoice,
            kind: scene.media?.kind,
            captions: scene.captions,
            frames: scene.frames,
            imagePrompt: scene.imagePrompt,
          })),
        }),
      );
      for (const [i, shot] of draft.scenes.entries()) {
        if (!shot.media) throw new Error(`Add a visual to scene ${i + 1}.`);
        form.set(`visual-${i}`, await assetBlob(shot.media), shot.media.name);
        if (shot.voice) form.set(`voice-${i}`, await assetBlob(shot.voice), 'voice');
      }
      if (draft.music) form.set('music', await assetBlob(draft.music), draft.music.name);
      const {id} = await (
        await api('export', {method: 'POST', headers: {'X-Short-Studio': '1'}, body: form})
      ).json();
      setJob({id, phase: 'Preparing scenes', progress: 0});
    } catch (issue) {
      setJob({phase: 'Failed', progress: 0, error: issue instanceof Error ? issue.message : String(issue)});
    }
  }

  async function startPaid(input: PaidInput, track?: File) {
    if (running || voiceScene) return;
    setJob({phase: 'Preparing scenes', progress: 0});
    setDialog('export');
    try {
      const headers: Record<string, string> = {'X-Short-Studio': '1'};
      let body: FormData | string;
      if (track) {
        body = new FormData();
        body.set('request', JSON.stringify(input));
        body.set('music', track);
      } else {
        body = JSON.stringify(input);
        headers['Content-Type'] = 'application/json';
      }
      const {id} = await (await api('paid', {method: 'POST', headers, body})).json();
      setJob({id, phase: 'Preparing scenes', progress: 0});
    } catch (issue) {
      setJob({phase: 'Failed', progress: 0, error: issue instanceof Error ? issue.message : String(issue)});
    }
  }

  async function openFolder(files: File[]) {
    if (!files.length) return;
    setOpening(true);
    setError('');
    try {
      const {importFolder} = await import('./project-import.ts');
      setIncoming(await importFolder(files));
      setDialog('import');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setOpening(false);
    }
  }

  async function openGenerated(id: string) {
    setOpening(true);
    setError('');
    try {
      const {importJob} = await import('./project-import.ts');
      setIncoming(await importJob(id));
      setDialog('import');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
      setDialog(undefined);
    } finally {
      setOpening(false);
    }
  }

  function replaceDraft(next: Draft) {
    setIncoming(undefined);
    setDraft(next);
    setSelectedId(next.scenes[0].id);
    setError('');
    setDialog(undefined);
  }

  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Clapperboard size={19} strokeWidth={2.5} />
          </span>{' '}
          Short Studio
        </div>
        <div className="top-actions">
          <span className="local">
            <span /> Local workspace
          </span>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button className="project-menu" variant="default" rightSection={<ChevronDown size={14} />}>
                Project
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Plus size={15} />} onClick={() => setDialog('new')}>
                New project
              </Menu.Item>
              <Menu.Item
                disabled={opening}
                leftSection={<FolderOpen size={15} />}
                onClick={() => folderPicker.current?.click()}
              >
                Open project folder
              </Menu.Item>
              <Menu.Item
                disabled={running || !!voiceScene}
                leftSection={<Sparkles size={15} />}
                onClick={() => setDialog('paid')}
              >
                Generate from topic
              </Menu.Item>
              <Menu.Item leftSection={<ClipboardPaste size={15} />} onClick={() => setDialog('script')}>
                Paste script
              </Menu.Item>
              <Menu.Item leftSection={<RotateCcw size={15} />} onClick={() => setDialog('sample')}>
                Load sample project
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Tooltip
            label={
              invalidCaptions
                ? 'Fix empty captions or invalid caption times'
                : 'Add a title, narration and visual to each scene'
            }
            disabled={ready}
          >
            <span>
              <Button
                className="primary"
                loading={running}
                disabled={!ready || !hydrated || !!voiceScene}
                leftSection={<ArrowDownToLine size={16} />}
                onClick={exportVideo}
              >
                Export MP4
              </Button>
            </span>
          </Tooltip>
        </div>
      </header>

      <input
        type="file"
        ref={folderPicker}
        hidden
        {...{webkitdirectory: ''}}
        multiple
        aria-label="Project folder"
        onChange={(event) => {
          void openFolder(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      <main>
        <div className="project-header">
          <div className="project-title">
            <label htmlFor="project-title">
              <Layers size={15} /> STORYBOARD
            </label>
            <input
              id="project-title"
              aria-label="Project title"
              value={draft.title}
              maxLength={200}
              placeholder="Untitled short"
              onChange={(event) => setDraft({...draft, title: event.target.value})}
            />
          </div>
          <div className="project-meta">
            {job && (
              <Button variant="subtle" color="gray" size="xs" onClick={() => setDialog('export')}>
                {job.phase}
              </Button>
            )}
            <span>
              <Check size={14} />{' '}
              {saveError ? 'Draft storage unavailable' : hydrated ? 'Saved on this device' : 'Loading draft'}
            </span>
            <span className="meta-divider" />
            <strong>~{formatTime(totalSeconds)}</strong>
          </div>
        </div>

        {error && (
          <Alert
            className="studio-alert"
            color="red"
            withCloseButton
            onClose={() => setError('')}
            role="alert"
          >
            {error}
          </Alert>
        )}
        <div className="workbench">
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
              {draft.scenes.map((s, i) => (
                <button
                  type="button"
                  className={`scene-row ${s.id === scene.id ? 'selected' : ''}`}
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  aria-pressed={s.id === scene.id}
                >
                  <Thumbnail scene={s} />
                  <span className="row-content">
                    <span className="row-title">
                      <span className="row-index">{String(i + 1).padStart(2, '0')}</span>
                      {s.name}
                    </span>
                    <span className="row-copy">{s.narration || 'Add narration'}</span>
                    <span className="row-meta">
                      {s.media?.kind === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}
                      {s.media?.kind === 'video' ? 'Video' : s.media ? 'Image' : 'No visual'} <span>·</span>{' '}
                      {secondsFor(s).toFixed(1)}s
                    </span>
                  </span>
                </button>
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
            <div className="music-box">
              <div className="music-icon">
                <Music2 size={17} />
              </div>
              <div>
                <strong>Soundtrack</strong>
                <span>{draft.music?.name ?? 'Optional background audio'}</span>
              </div>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={draft.music ? 'Remove soundtrack' : 'Upload soundtrack'}
                onClick={() =>
                  draft.music ? setDraft({...draft, music: undefined}) : musicPicker.current?.click()
                }
              >
                {draft.music ? <X size={16} /> : <Plus size={17} />}
              </ActionIcon>
              <input
                type="file"
                accept="audio/*"
                hidden
                ref={musicPicker}
                aria-label="Soundtrack file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setDraft({...draft, music: {name: file.name, kind: 'audio', source: file}});
                  event.target.value = '';
                }}
              />
            </div>
          </section>

          <section className="center" aria-label="Preview and timeline">
            <Preview scenes={draft.scenes} selectedIndex={index} music={draft.music} />
            <div className="timeline panel">
              <div className="timeline-head">
                <span>
                  <MonitorPlay size={15} /> Scene timeline
                </span>
                <strong>
                  {draft.scenes.length} {draft.scenes.length === 1 ? 'scene' : 'scenes'}
                </strong>
              </div>
              <div className="timeline-strip">
                {draft.scenes.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Preview scene ${i + 1}`}
                    aria-pressed={s.id === scene.id}
                    className={s.id === scene.id ? 'active' : ''}
                    style={{flexGrow: secondsFor(s)}}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <Thumbnail scene={s} />
                    <span>{String(i + 1).padStart(2, '0')}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel inspector" aria-label="Scene settings">
            <div className="panel-heading">
              <div>
                <span className="inspector-number">{String(index + 1).padStart(2, '0')}</span>{' '}
                <h2>Scene details</h2>
              </div>
              <SceneActions
                index={index}
                total={draft.scenes.length}
                move={moveScene}
                remove={() => {
                  const remainder = draft.scenes.filter((s) => s.id !== scene.id);
                  if (!remainder.length) return;
                  setSelectedId(remainder[Math.min(index, remainder.length - 1)].id);
                  setDraft({...draft, scenes: remainder});
                }}
              />
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
                      {scene.media?.kind === 'video'
                        ? 'MP4 clip'
                        : scene.media
                          ? 'Still image'
                          : 'Image or MP4'}
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
              {scene.imagePrompt && (
                <Textarea
                  label="Illustration prompt"
                  readOnly
                  value={scene.imagePrompt}
                  minRows={2}
                  maxRows={5}
                  autosize
                />
              )}
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
                      voice: undefined,
                      seconds: undefined,
                      frames: undefined,
                      captions: undefined,
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
                    if (
                      !voice ||
                      !isKokoroVoice(voice) ||
                      voice === (scene.kokoroVoice ?? defaultKokoroVoice)
                    )
                      return;
                    patchScene(scene.id, {
                      kokoroVoice: voice,
                      voice: undefined,
                      seconds: undefined,
                      frames: undefined,
                      captions: undefined,
                    });
                  }}
                />
                <div className="narration-actions">
                  <span>
                    {scene.voice ? (
                      <>
                        <Check size={13} /> Voice ready
                      </>
                    ) : (
                      'Voice pending'
                    )}
                  </span>
                  <Button
                    loading={voiceScene === scene.id}
                    disabled={!scene.narration.trim() || !!voiceScene || running}
                    leftSection={<AudioLines size={14} />}
                    size="compact-sm"
                    variant="default"
                    onClick={() => void generateVoice()}
                  >
                    {scene.voice ? 'Regenerate voice' : 'Generate voice'}
                  </Button>
                </div>
              </div>
              <details className="caption-panel">
                <summary>
                  Captions{' '}
                  <span>
                    {captionsFor(scene).length} cues <ChevronDown size={13} />
                  </span>
                </summary>
                {!scene.voice && <p>Generate narration before editing caption timing.</p>}
                {scene.voice &&
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
                            error={cue.end <= cue.start}
                            decimalScale={2}
                            step={0.05}
                            min={0}
                            max={secondsFor(scene) + 0.1}
                            value={cue[edge]}
                            onChange={(value) => {
                              if (typeof value === 'number')
                                patchScene(scene.id, {
                                  captions: cues.map((item, j) =>
                                    j === i ? {...item, [edge]: value} : item,
                                  ),
                                });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              </details>
            </div>
          </section>
        </div>
      </main>

      {dialog === 'paid' && (
        <Suspense fallback={null}>
          <PaidDialog
            selection={paidSelection}
            setSelection={setPaidSelection}
            opened
            close={() => setDialog(undefined)}
            submit={(input, track) => void startPaid(input, track)}
          />
        </Suspense>
      )}
      <Modal
        opened={dialog === 'import'}
        onClose={() => {
          setIncoming(undefined);
          setDialog(undefined);
        }}
        title="Open project"
        centered
      >
        {incoming && (
          <>
            <strong>{incoming.title}</strong>
            <p className="modal-note">
              {incoming.scenes.length} {incoming.scenes.length === 1 ? 'scene' : 'scenes'}. This replaces the
              draft saved in this browser.
            </p>
            {incoming.scenes.some((scene) => !scene.media) && (
              <p className="modal-note">Attach visuals to the empty scenes before exporting.</p>
            )}
            <Button className="primary" onClick={() => replaceDraft(incoming)}>
              Open in editor
            </Button>
          </>
        )}
      </Modal>
      <Modal
        opened={dialog === 'script'}
        onClose={() => setDialog(undefined)}
        title="Paste a script"
        centered
      >
        <Textarea
          label="One scene per paragraph"
          placeholder="Paste your narration here…"
          value={script}
          minRows={7}
          onChange={(event) => setScript(event.currentTarget.value)}
        />
        <p className="modal-note">
          This replaces the current scenes. Attach a visual to each new scene before exporting.
        </p>
        <Button className="primary" disabled={!script.trim()} onClick={importScript}>
          Create scenes
        </Button>
      </Modal>
      <Modal
        opened={dialog === 'new' || dialog === 'sample'}
        onClose={() => setDialog(undefined)}
        title={dialog === 'new' ? 'Start a new project?' : 'Load the sample project?'}
        centered
      >
        <p className="modal-note">This replaces the draft saved in this browser.</p>
        <Button
          className="primary"
          onClick={() =>
            replaceDraft(dialog === 'sample' ? sampleDraft : {title: '', scenes: [freshScene()]})
          }
        >
          {dialog === 'new' ? 'New project' : 'Load sample'}
        </Button>
      </Modal>
      <Modal
        opened={dialog === 'export'}
        onClose={() => setDialog(undefined)}
        title="Generation and export"
        centered
      >
        <div aria-live="polite" className="export-status">
          <strong>{job?.phase}</strong>
          {running && (
            <Progress
              value={job?.phase === 'Rendering video' ? (job?.progress ?? 0) * 100 : 18}
              color="lime"
              animated
              striped={job?.phase !== 'Rendering video'}
            />
          )}
          {job?.phase === 'Failed' && (
            <Alert color="red" icon={<Info size={16} />}>
              {job.error}
            </Alert>
          )}
          {!running && job?.id && job.hasDraft && (
            <Button
              variant="default"
              loading={opening}
              leftSection={<FolderOpen size={16} />}
              onClick={() => {
                if (job.id) void openGenerated(job.id);
              }}
            >
              Review generated project
            </Button>
          )}
          {videoUrl && (
            <>
              {/* biome-ignore lint/a11y/useMediaCaption: Remotion burns captions into the exported video. */}
              <video className="export-video" src={videoUrl} controls playsInline preload="metadata" />
              <Button
                component="a"
                className="primary"
                href={videoUrl}
                download="short.mp4"
                leftSection={<ArrowDownToLine size={16} />}
              >
                Download MP4
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing Short Studio root element.');
createRoot(root).render(
  <MantineProvider theme={theme} forceColorScheme="dark">
    <Studio />
  </MantineProvider>,
);
