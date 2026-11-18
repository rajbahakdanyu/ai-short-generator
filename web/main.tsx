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
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Clapperboard,
  ClipboardPaste,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Layers,
  MonitorPlay,
  Music2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {defaultKokoroVoice, kokoroVoices} from '../src/kokoro-voices.ts';
import {captionIssue, maxCaptions, maxProjectFrames, maxSceneFrames, maxScenes} from '../src/project.ts';
import type {PaidSelection} from '../src/providers/catalog.ts';
import {deleteSnapshot, listSnapshots, type Snapshot, saveSnapshot, useDraft} from './draft-state.ts';
import {jsonHeaders, mutationHeaders, useStudioJobs} from './job-state.ts';
import {
  type Asset,
  api,
  assetBlob,
  type Draft,
  type DraftScene,
  formatTime,
  framesFor,
  freshScene,
  type Job,
  sampleDraft,
  secondsFor,
} from './model.ts';
import type {PaidInput} from './paid-dialog.tsx';
import {Preview, Thumbnail} from './preview.tsx';
import {SceneInspector} from './scene-inspector.tsx';
import {newRecording} from './scene-state.ts';

const PaidDialog = lazy(async () => ({default: (await import('./paid-dialog.tsx')).PaidDialog}));
const theme = createTheme({
  fontFamily: 'Inter Variable, system-ui, sans-serif',
  defaultRadius: 'md',
  respectReducedMotion: true,
});

function Studio() {
  const {draft, setDraft, hydrated, saveError, canUndo, canRedo, undo, redo} = useDraft();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(sampleDraft.scenes[0].id);
  const [error, setError] = useState('');
  const [voiceScene, setVoiceScene] = useState<string>();
  const [dialog, setDialog] = useState<
    'script' | 'new' | 'sample' | 'export' | 'paid' | 'import' | 'library' | 'outputs'
  >();
  const [paidSelection, setPaidSelection] = useState<PaidSelection>({});
  const [script, setScript] = useState('');
  const {job, setJob, running, pollError} = useStudioJobs();
  const [outputs, setOutputs] = useState<{id: string; startedAt: number; phase: string; bytes: number}[]>([]);
  const [resumeId, setResumeId] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [incoming, setIncoming] = useState<Draft>();
  const [opening, setOpening] = useState(false);
  const folderPicker = useRef<HTMLInputElement>(null);
  const draftPicker = useRef<HTMLInputElement>(null);
  const musicPicker = useRef<HTMLInputElement>(null);
  const index = Math.max(
    0,
    draft.scenes.findIndex((s) => s.id === selectedId),
  );
  const scene = draft.scenes[index];
  const totalSeconds = draft.scenes.reduce((sum, s) => sum + secondsFor(s), 0);
  const invalidCaptions = draft.scenes.some(
    (s) =>
      (s.captions?.length ?? 0) > maxCaptions ||
      s.captions?.some((_, i, cues) => captionIssue(cues, i, framesFor(s))),
  );
  const withinLimits =
    draft.scenes.length <= maxScenes &&
    draft.scenes.every((item) => framesFor(item) <= maxSceneFrames) &&
    draft.scenes.reduce((sum, item) => sum + framesFor(item), 0) <= maxProjectFrames;
  const ready =
    !!draft.title.trim() &&
    withinLimits &&
    !invalidCaptions &&
    draft.scenes.every((s) => s.narration.trim() && s.media);
  const videoUrl =
    job?.id && job.hasVideo && job.phase === 'Complete' ? `/api/studio/jobs/${job.id}/video` : undefined;

  useEffect(() => {
    const startedAt = job?.startedAt;
    if (!running || !startedAt) return;
    const update = () => setElapsed(Math.max(0, (Date.now() - startedAt) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [job?.startedAt, running]);

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
    if (draft.scenes.length >= maxScenes) return;
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
    if (paragraphs.length > maxScenes || paragraphs.some((part) => part.length > 4000)) {
      setError('Scripts support 100 scenes and 4,000 narration characters per scene.');
      return;
    }
    const scenes = paragraphs.map((part, i) => ({...freshScene(part), name: `Scene ${i + 1}`}));
    void replaceDraft({...draft, scenes});
    setScript('');
  }

  async function generateVoice() {
    const {id, narration, voice: previousVoice, captions: previousCaptions} = scene;
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
          s.id === id &&
          s.narration === narration &&
          s.voice === previousVoice &&
          s.captions === previousCaptions &&
          (s.kokoroVoice ?? defaultKokoroVoice) === kokoroVoice
            ? {...s, ...newRecording(voice, seconds), kokoroVoice}
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
          musicVolume: draft.musicVolume,
          scenes: draft.scenes.map((scene) => ({
            name: scene.name,
            sources: scene.sources,
            narration: scene.narration,
            kokoroVoice: scene.kokoroVoice,
            kind: scene.media?.kind,
            captions: scene.voiceOutdated ? undefined : scene.captions,
            frames: scene.frames,
            imagePrompt: scene.imagePrompt,
          })),
        }),
      );
      for (const [i, shot] of draft.scenes.entries()) {
        if (!shot.media) throw new Error(`Add a visual to scene ${i + 1}.`);
        form.set(`visual-${i}`, await assetBlob(shot.media), shot.media.name);
        if (shot.voice && !shot.voiceOutdated) form.set(`voice-${i}`, await assetBlob(shot.voice), 'voice');
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
    if (!resumeId) setJob({phase: 'Preparing scenes', progress: 0});
    setDialog('export');
    try {
      if (resumeId) {
        await api(`jobs/${resumeId}/resume`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(input),
        });
        setJob({id: resumeId, phase: 'Preparing scenes', progress: 0});
        setResumeId(undefined);
        return;
      }
      const headers: Record<string, string> = {...mutationHeaders};
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
      setJob({
        ...(resumeId && job ? job : {progress: 0}),
        phase: 'Failed',
        error: issue instanceof Error ? issue.message : String(issue),
      });
    }
  }

  async function refreshOutputs() {
    setOutputs(await (await api('jobs')).json());
    setDialog('outputs');
  }

  async function viewJob(id: string) {
    const status: Job = await (await api(`jobs/${id}`)).json();
    setJob({...status, id});
    setDialog('export');
  }

  async function resumeLocalRender(previous: Job) {
    if (!previous.id) return;
    try {
      await api(`jobs/${previous.id}/resume`, {method: 'POST', headers: mutationHeaders});
      setJob({id: previous.id, phase: 'Rendering video', progress: 0});
    } catch (issue) {
      setJob({...previous, error: issue instanceof Error ? issue.message : String(issue)});
    }
  }

  function cancelJob(id: string) {
    if (window.confirm('Stop generation? Completed provider calls may still be charged.'))
      void api(`jobs/${id}/cancel`, {method: 'POST', headers: mutationHeaders}).catch((issue) =>
        setError(String(issue)),
      );
  }

  function downloadEditableDraft() {
    void import('./draft-file.ts')
      .then(({downloadDraft}) => downloadDraft(draft))
      .catch((issue) => setError(String(issue)));
  }

  async function openEditableDraft(file?: File) {
    if (!file) return;
    try {
      const {openDraftFile} = await import('./draft-file.ts');
      setIncoming(await openDraftFile(file));
      setDialog('import');
    } catch (issue) {
      setError(String(issue));
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

  async function protectDraft(action: () => void | Promise<void>) {
    if (!hydrated || saving) return;
    setSaving(true);
    try {
      await saveSnapshot(draft);
      await action();
    } catch (issue) {
      setError(`Could not save the current draft. ${String(issue)}`);
    } finally {
      setSaving(false);
    }
  }

  async function refreshLibrary() {
    setSnapshots(await listSnapshots());
    setDialog('library');
  }

  function replaceDraft(next: Draft) {
    return protectDraft(() => {
      setIncoming(undefined);
      setDraft(next);
      setSelectedId(next.scenes[0].id);
      setError('');
      setDialog(undefined);
    });
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
              <Menu.Item disabled={saving || !hydrated} onClick={() => void protectDraft(refreshLibrary)}>
                Save a copy
              </Menu.Item>
              <Menu.Item onClick={() => void refreshLibrary().catch((issue) => setError(String(issue)))}>
                Saved projects
              </Menu.Item>
              <Menu.Item disabled={!hydrated} onClick={downloadEditableDraft}>
                Download editable draft
              </Menu.Item>
              <Menu.Item onClick={() => draftPicker.current?.click()}>Open editable draft</Menu.Item>
              <Menu.Item disabled={!canUndo} onClick={undo}>
                Undo
              </Menu.Item>
              <Menu.Item disabled={!canRedo} onClick={redo}>
                Redo
              </Menu.Item>
              <Menu.Divider />
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
                onClick={() => {
                  setResumeId(undefined);
                  setDialog('paid');
                }}
              >
                Generate from topic
              </Menu.Item>
              <Menu.Item onClick={() => void refreshOutputs().catch((issue) => setError(String(issue)))}>
                Generation history{' '}
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
                : !withinLimits
                  ? 'Projects support 100 scenes, two minutes per scene and ten minutes total'
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
        hidden
        ref={draftPicker}
        accept=".json"
        aria-label="Editable draft file"
        onChange={(event) => {
          void openEditableDraft(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
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
              {draft.music && (
                <NumberInput
                  label="Soundtrack volume (%)"
                  min={0}
                  max={100}
                  value={Math.round((draft.musicVolume ?? 0.13) * 100)}
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
            <Preview
              scenes={draft.scenes}
              selectedIndex={index}
              music={draft.music}
              musicVolume={draft.musicVolume}
            />
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

          <SceneInspector
            key={scene.id}
            scene={scene}
            index={index}
            total={draft.scenes.length}
            patchScene={patchScene}
            moveScene={moveScene}
            removeScene={() => {
              const remainder = draft.scenes.filter((s) => s.id !== scene.id);
              if (!remainder.length) return;
              setSelectedId(remainder[Math.min(index, remainder.length - 1)].id);
              setDraft({...draft, scenes: remainder});
            }}
            voiceBusy={!!voiceScene || running}
            voiceLoading={voiceScene === scene.id}
            generateVoice={generateVoice}
            setError={setError}
          />
        </div>
      </main>

      <Modal
        opened={dialog === 'library'}
        title="Saved projects"
        onClose={() => setDialog(undefined)}
        centered
      >
        {!snapshots.length && (
          <p className="modal-note">Saved copies and drafts replaced in the editor appear here.</p>
        )}
        {snapshots.map((snapshot) => (
          <div className="narration-actions" key={snapshot.id}>
            <div>
              <strong>{snapshot.draft.title || 'Untitled project'}</strong>
              <div>{new Date(snapshot.savedAt).toLocaleString()}</div>
            </div>
            <Button size="compact-sm" disabled={saving} onClick={() => void replaceDraft(snapshot.draft)}>
              Open
            </Button>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Delete saved copy"
              onClick={() => {
                if (window.confirm('Permanently delete this saved copy?'))
                  void deleteSnapshot(snapshot.id)
                    .then(refreshLibrary)
                    .catch((issue) => setError(String(issue)));
              }}
            >
              <Trash2 size={15} />
            </ActionIcon>
          </div>
        ))}
      </Modal>
      <Modal
        opened={dialog === 'outputs'}
        title="Generation history"
        onClose={() => setDialog(undefined)}
        centered
      >
        {!outputs.length && <p className="modal-note">Studio jobs appear here after you start generation.</p>}
        {outputs.map((output) => (
          <div className="narration-actions" key={output.id}>
            <div>
              <strong>{output.phase}</strong>
              <div>
                {new Date(output.startedAt).toLocaleString()} · {(output.bytes / 1024 ** 2).toFixed(1)} MB
              </div>
            </div>
            <Button
              size="compact-sm"
              onClick={() => void viewJob(output.id).catch((issue) => setError(String(issue)))}
            >
              Open
            </Button>
            <ActionIcon
              variant="subtle"
              color="red"
              disabled={output.phase === 'Running'}
              aria-label="Delete generated output"
              onClick={() => {
                if (window.confirm('Permanently delete this job and its output files?'))
                  void api(`jobs/${output.id}`, {method: 'DELETE', headers: mutationHeaders})
                    .then(() => {
                      if (job?.id === output.id) setJob(undefined);
                      return refreshOutputs();
                    })
                    .catch((issue) => setError(String(issue)));
              }}
            >
              <Trash2 size={15} />
            </ActionIcon>
          </div>
        ))}
      </Modal>
      {dialog === 'paid' && (
        <Suspense fallback={null}>
          <PaidDialog
            resume={!!resumeId}
            spendingLimit={resumeId ? job?.spendingLimit : undefined}
            draft={draft}
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
              {incoming.scenes.length} {incoming.scenes.length === 1 ? 'scene' : 'scenes'}. Studio saves a
              recovery copy of the current draft before opening this project.
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
          Studio saves a recovery copy of the current draft. Attach a visual to each new scene before
          exporting.
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
        <p className="modal-note">Studio saves a recovery copy of the current draft.</p>
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
          {running && job?.detail && (
            <p>
              {job.detail} · {formatTime(elapsed)} elapsed
            </p>
          )}
          {job?.usage && (
            <div>
              Provider requests attempted: {job.usage.script} script · {job.usage.visual} visual ·{' '}
              {job.usage.voice} voice.
              {job.estimatedSpend !== undefined && (
                <p>
                  Estimated spend ${job.estimatedSpend.toFixed(2)} USD of ${job.spendingLimit?.toFixed(2)}{' '}
                  USD.
                </p>
              )}
            </div>
          )}
          {pollError && <Alert color="yellow">{pollError}</Alert>}
          {running && job?.id && (
            <Button
              variant="default"
              onClick={() => {
                if (job.id) cancelJob(job.id);
              }}
            >
              Stop generation
            </Button>
          )}
          {!running && job?.id && job.resumable && (
            <Button
              variant="default"
              onClick={() => {
                if (job.resumeNeedsProviders) {
                  setResumeId(job.id);
                  setDialog('paid');
                } else {
                  void resumeLocalRender(job);
                }
              }}
            >
              Resume generation
            </Button>
          )}
          {running && (
            <Progress
              value={(job?.progress ?? 0) * 100}
              color="lime"
              animated
              striped={job?.phase !== 'Rendering video'}
            />
          )}
          {(job?.phase === 'Failed' || job?.phase === 'Cancelled') && (
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
