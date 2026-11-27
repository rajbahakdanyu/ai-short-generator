import {Alert} from '@mantine/core';
import {useLocalStorage} from '@mantine/hooks';
import {lazy, Suspense, useState} from 'react';
import {errorMessage} from '../src/errors.ts';
import {defaultKokoroVoice, kokoroVoices} from '../src/kokoro-voices.ts';
import {maxScenes} from '../src/project.ts';
import type {PaidSelection} from '../src/providers/catalog.ts';
import {exportForm, getJson, paidBody, post, remove, startJob} from './api.ts';
import {audioDuration, sampleDraft} from './assets.ts';
import {Preview} from './components/preview.tsx';
import {ProjectHeader, WelcomePanel} from './components/project-header.tsx';
import {SceneInspector} from './components/scene-inspector.tsx';
import {ScenePanel} from './components/scene-panel.tsx';
import {SceneTimeline} from './components/scene-timeline.tsx';
import {Topbar} from './components/topbar.tsx';
import {ExportDialog} from './dialogs/export-dialog.tsx';
import {LocalGenerationDialog} from './dialogs/local-generation-dialog.tsx';
import {LocalReviewDialog} from './dialogs/local-review-dialog.tsx';
import {
  HistoryDialog,
  OpenProjectDialog,
  PasteScriptDialog,
  ReplaceProjectDialog,
  SavedProjectsDialog,
} from './dialogs/project-dialogs.tsx';
import {useDraft} from './draft-state.ts';
import {failedJob, useStudioJobs} from './job-state.ts';
import {useProjectLibrary} from './library-state.ts';
import {useLocalGeneration} from './local-generation-state.ts';
import {
  type Asset,
  type DraftScene,
  freshScene,
  type Job,
  type JobSummary,
  type PaidInput,
  type StudioDialog,
  secondsFor,
} from './model.ts';
import {exportIssue, newRecording} from './scene-state.ts';

const PaidDialog = lazy(async () => ({default: (await import('./dialogs/paid-dialog.tsx')).PaidDialog}));

export function Studio() {
  const {draft, setDraft, hydrated, saveError, canUndo, canRedo, undo, redo} = useDraft();
  const [selectedId, setSelectedId] = useState(sampleDraft.scenes[0].id);
  const [error, setError] = useState('');
  const [voiceScene, setVoiceScene] = useState<string>();
  const [dialog, setDialog] = useState<StudioDialog>();
  const [paidSelection, setPaidSelection] = useState<PaidSelection>({});
  const [resumeId, setResumeId] = useState<string>();
  const [outputs, setOutputs] = useState<JobSummary[]>([]);
  const [guideDismissed, setGuideDismissed] = useLocalStorage({
    key: 'short-studio-guide-dismissed',
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  const {job, setJob, running, pollError} = useStudioJobs();
  const library = useProjectLibrary({draft, hydrated, setDraft, select: setSelectedId, setDialog, setError});
  const local = useLocalGeneration({running, setJob, setDialog, setError});
  const index = Math.max(
    0,
    draft.scenes.findIndex((item) => item.id === selectedId),
  );
  const scene = draft.scenes[index];
  const busy = running || !!voiceScene;
  const issue = exportIssue(draft);
  const report = (problem: unknown) => setError(errorMessage(problem));
  const closeDialog = () => setDialog(undefined);

  function patchScene(id: string, patch: Partial<DraftScene>) {
    setDraft((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.id === id ? {...item, ...patch} : item)),
    }));
  }

  function moveScene(delta: number) {
    setDraft((current) => {
      const scenes = [...current.scenes];
      const from = scenes.findIndex((item) => item.id === scene.id);
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

  function removeScene() {
    if (!window.confirm(`Delete "${scene.name}"? You can undo this from Project > Undo.`)) return;
    const remainder = draft.scenes.filter((item) => item.id !== scene.id);
    if (!remainder.length) return;
    setSelectedId(remainder[Math.min(index, remainder.length - 1)].id);
    setDraft({...draft, scenes: remainder});
  }

  async function generateVoice() {
    const {id, narration, voice: previousVoice, captions: previousCaptions} = scene;
    const kokoroVoice = scene.kokoroVoice ?? defaultKokoroVoice;
    setVoiceScene(id);
    setError('');
    try {
      const source = await (await post('voice', {narration, kokoroVoice})).blob();
      const seconds = await audioDuration(source);
      const voice: Asset = {name: kokoroVoices[kokoroVoice], kind: 'audio', source};
      setDraft((current) => ({
        ...current,
        scenes: current.scenes.map((item) =>
          item.id === id &&
          item.narration === narration &&
          item.voice === previousVoice &&
          item.captions === previousCaptions &&
          (item.kokoroVoice ?? defaultKokoroVoice) === kokoroVoice
            ? {...item, ...newRecording(voice, seconds), kokoroVoice}
            : item,
        ),
      }));
    } catch (problem) {
      report(problem);
    } finally {
      setVoiceScene(undefined);
    }
  }

  async function exportVideo() {
    if (issue || busy) return;
    setJob({phase: 'Uploading media', progress: 0});
    setDialog('export');
    try {
      const id = await startJob('export', await exportForm(draft));
      setJob({id, phase: 'Preparing scenes', progress: 0});
    } catch (problem) {
      setJob(failedJob(problem));
    }
  }

  async function startPaid(input: PaidInput, track?: File) {
    if (busy) return;
    if (!resumeId) setJob({phase: 'Preparing scenes', progress: 0});
    setDialog('export');
    try {
      if (resumeId) {
        await post(`jobs/${resumeId}/resume`, input);
        setJob({id: resumeId, phase: 'Preparing scenes', progress: 0});
        setResumeId(undefined);
        return;
      }
      const id = await startJob('paid', paidBody(input, track));
      setJob({id, phase: 'Preparing scenes', progress: 0});
    } catch (problem) {
      setJob(failedJob(problem, resumeId ? job : undefined));
    }
  }

  function openPaid(id?: string) {
    setResumeId(id);
    setDialog('paid');
  }

  async function showHistory() {
    setOutputs(await getJson<JobSummary[]>('jobs'));
    setDialog('outputs');
  }

  async function viewJob(id: string) {
    const status = await getJson<Job>(`jobs/${id}`);
    setJob({...status, id});
    setDialog('export');
  }

  async function deleteOutput(id: string) {
    await remove(`jobs/${id}`);
    if (job?.id === id) setJob(undefined);
    await showHistory();
  }

  return (
    <div className="studio">
      <Topbar
        library={library}
        hydrated={hydrated}
        busy={busy}
        running={running}
        canUndo={canUndo}
        canRedo={canRedo}
        undo={undo}
        redo={redo}
        exportIssue={issue}
        exportVideo={exportVideo}
        openDialog={setDialog}
        openLocal={local.open}
        openPaid={() => openPaid()}
        openHistory={() => void showHistory().catch(report)}
        showGuide={() => {
          setGuideDismissed(false);
          window.scrollTo(0, 0);
        }}
      />
      <main>
        {!guideDismissed && (
          <WelcomePanel
            disabled={busy}
            start={() => {
              setGuideDismissed(true);
              local.open('short', 'How do fireflies glow?');
            }}
            dismiss={() => setGuideDismissed(true)}
          />
        )}
        <ProjectHeader
          title={draft.title}
          setTitle={(title) => setDraft((current) => ({...current, title}))}
          job={job}
          openJob={() => setDialog('export')}
          hydrated={hydrated}
          saveError={saveError}
          totalSeconds={draft.scenes.reduce((sum, item) => sum + secondsFor(item), 0)}
        />
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
          <ScenePanel
            draft={draft}
            selectedId={scene.id}
            select={setSelectedId}
            addScene={addScene}
            setDraft={setDraft}
          />
          <section className="center" aria-label="Preview and timeline">
            <Preview
              scenes={draft.scenes}
              selectedIndex={index}
              music={draft.music}
              musicVolume={draft.musicVolume}
            />
            <SceneTimeline scenes={draft.scenes} selectedId={scene.id} select={setSelectedId} />
          </section>
          <SceneInspector
            key={scene.id}
            scene={scene}
            index={index}
            total={draft.scenes.length}
            patchScene={patchScene}
            moveScene={moveScene}
            removeScene={removeScene}
            voiceBusy={busy}
            voiceLoading={voiceScene === scene.id}
            generateVoice={generateVoice}
            setError={setError}
          />
        </div>
      </main>

      <SavedProjectsDialog
        opened={dialog === 'library'}
        close={closeDialog}
        snapshots={library.snapshots}
        saving={library.saving}
        open={(next) => void library.replaceDraft(next)}
        remove={library.removeSnapshot}
      />
      <HistoryDialog
        opened={dialog === 'outputs'}
        close={closeDialog}
        outputs={outputs}
        open={(id) => void viewJob(id).catch(report)}
        remove={(id) => void deleteOutput(id).catch(report)}
      />
      {dialog === 'paid' && (
        <Suspense fallback={null}>
          <PaidDialog
            resume={!!resumeId}
            spendingLimit={resumeId ? job?.spendingLimit : undefined}
            draft={draft}
            selection={paidSelection}
            setSelection={setPaidSelection}
            opened
            close={closeDialog}
            submit={(input, track) => void startPaid(input, track)}
          />
        </Suspense>
      )}
      <OpenProjectDialog
        incoming={library.incoming}
        opened={dialog === 'import'}
        close={library.closeIncoming}
        open={(next) => void library.replaceDraft(next)}
      />
      <LocalGenerationDialog opened={dialog === 'local'} close={closeDialog} local={local} busy={busy} />
      <PasteScriptDialog
        opened={dialog === 'script'}
        close={closeDialog}
        create={(scenes) => void library.replaceDraft({...draft, scenes})}
        setError={setError}
      />
      <ReplaceProjectDialog
        dialog={dialog}
        close={closeDialog}
        replace={(next) => void library.replaceDraft(next)}
      />
      <LocalReviewDialog
        opened={dialog === 'local-review'}
        close={() => setDialog('export')}
        review={local.review}
        setReview={local.setReview}
        prepare={() => void local.prepareReview()}
      />
      <ExportDialog
        opened={dialog === 'export'}
        close={closeDialog}
        job={job}
        setJob={setJob}
        running={running}
        pollError={pollError}
        opening={library.opening}
        setError={setError}
        resumePaid={openPaid}
        reviewStoryboard={(id) => void local.openReview(id)}
        openGenerated={(id) => void library.openGenerated(id)}
      />
    </div>
  );
}
