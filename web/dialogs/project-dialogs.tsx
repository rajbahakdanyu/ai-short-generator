import {ActionIcon, Button, Modal, Textarea} from '@mantine/core';
import {Trash2} from 'lucide-react';
import {type ReactNode, useState} from 'react';
import {errorMessage} from '../../src/errors.ts';
import {sampleDraft} from '../assets.ts';
import type {Snapshot} from '../draft-state.ts';
import {type Draft, type DraftScene, freshScene, type JobSummary, type StudioDialog} from '../model.ts';
import {scriptScenes} from '../scene-state.ts';

function ListItem({
  title,
  detail,
  open,
  openDisabled,
  deleteLabel,
  deleteDisabled,
  confirm,
  remove,
}: {
  title: string;
  detail: ReactNode;
  open: () => void;
  openDisabled?: boolean;
  deleteLabel: string;
  deleteDisabled?: boolean;
  confirm: string;
  remove: () => void;
}) {
  return (
    <div className="narration-actions">
      <div>
        <strong>{title}</strong>
        <div>{detail}</div>
      </div>
      <Button size="compact-sm" disabled={openDisabled} onClick={open}>
        Open
      </Button>
      <ActionIcon
        variant="subtle"
        color="red"
        disabled={deleteDisabled}
        aria-label={deleteLabel}
        onClick={() => {
          if (window.confirm(confirm)) remove();
        }}
      >
        <Trash2 size={15} />
      </ActionIcon>
    </div>
  );
}

export function SavedProjectsDialog({
  opened,
  close,
  snapshots,
  saving,
  open,
  remove,
}: {
  opened: boolean;
  close: () => void;
  snapshots: Snapshot[];
  saving: boolean;
  open: (draft: Draft) => void;
  remove: (id: string) => void;
}) {
  return (
    <Modal opened={opened} title="Saved projects" onClose={close}>
      {!snapshots.length && (
        <p className="modal-note">Saved copies and drafts replaced in the editor appear here.</p>
      )}
      {snapshots.map((snapshot) => (
        <ListItem
          key={snapshot.id}
          title={snapshot.draft.title || 'Untitled project'}
          detail={new Date(snapshot.savedAt).toLocaleString()}
          open={() => open(snapshot.draft)}
          openDisabled={saving}
          deleteLabel="Delete saved copy"
          confirm="Permanently delete this saved copy?"
          remove={() => remove(snapshot.id)}
        />
      ))}
    </Modal>
  );
}

export function HistoryDialog({
  opened,
  close,
  outputs,
  open,
  remove,
}: {
  opened: boolean;
  close: () => void;
  outputs: JobSummary[];
  open: (id: string) => void;
  remove: (id: string) => void;
}) {
  return (
    <Modal opened={opened} title="Generation history" onClose={close}>
      {!outputs.length && <p className="modal-note">Studio jobs appear here after you start generation.</p>}
      {outputs.map((output) => (
        <ListItem
          key={output.id}
          title={output.phase}
          detail={
            <>
              {new Date(output.startedAt).toLocaleString()} · {(output.bytes / 1024 ** 2).toFixed(1)} MB
            </>
          }
          open={() => open(output.id)}
          deleteLabel="Delete generated output"
          deleteDisabled={output.phase === 'Running'}
          confirm="Permanently delete this job and its output files?"
          remove={() => remove(output.id)}
        />
      ))}
    </Modal>
  );
}

export function OpenProjectDialog({
  incoming,
  opened,
  close,
  open,
}: {
  incoming?: Draft;
  opened: boolean;
  close: () => void;
  open: (draft: Draft) => void;
}) {
  return (
    <Modal opened={opened} onClose={close} title="Open project">
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
          <Button className="primary" onClick={() => open(incoming)}>
            Open in editor
          </Button>
        </>
      )}
    </Modal>
  );
}

export function PasteScriptDialog({
  opened,
  close,
  create,
  setError,
}: {
  opened: boolean;
  close: () => void;
  create: (scenes: DraftScene[]) => void;
  setError: (message: string) => void;
}) {
  const [script, setScript] = useState('');
  function submit() {
    try {
      const scenes = scriptScenes(script);
      if (!scenes.length) return;
      create(scenes);
      setScript('');
    } catch (issue) {
      setError(errorMessage(issue));
    }
  }
  return (
    <Modal opened={opened} onClose={close} title="Paste a script">
      <Textarea
        label="One scene per paragraph"
        placeholder="Paste your narration here…"
        value={script}
        minRows={7}
        onChange={(event) => setScript(event.currentTarget.value)}
      />
      <p className="modal-note">
        Studio saves a recovery copy of the current draft. Attach a visual to each new scene before exporting.
      </p>
      <Button className="primary" disabled={!script.trim()} onClick={submit}>
        Create scenes
      </Button>
    </Modal>
  );
}

export function ReplaceProjectDialog({
  dialog,
  close,
  replace,
}: {
  dialog?: StudioDialog;
  close: () => void;
  replace: (draft: Draft) => void;
}) {
  const fresh = dialog === 'new';
  return (
    <Modal
      opened={dialog === 'new' || dialog === 'sample'}
      onClose={close}
      title={fresh ? 'Start a new project?' : 'Load the sample project?'}
    >
      <p className="modal-note">Studio saves a recovery copy of the current draft.</p>
      <Button
        className="primary"
        onClick={() => replace(dialog === 'sample' ? sampleDraft : {title: '', scenes: [freshScene()]})}
      >
        {fresh ? 'New project' : 'Load sample'}
      </Button>
    </Modal>
  );
}
