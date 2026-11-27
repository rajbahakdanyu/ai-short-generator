import {useState} from 'react';
import {errorMessage} from '../src/errors.ts';
import {deleteSnapshot, listSnapshots, type Snapshot, saveSnapshot} from './draft-state.ts';
import type {Draft, StudioDialog} from './model.ts';

type ProjectImport = typeof import('./project-import.ts');

export function useProjectLibrary({
  draft,
  hydrated,
  setDraft,
  select,
  setDialog,
  setError,
}: {
  draft: Draft;
  hydrated: boolean;
  setDraft: (draft: Draft) => void;
  select: (sceneId: string) => void;
  setDialog: (dialog?: StudioDialog) => void;
  setError: (message: string) => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [incoming, setIncoming] = useState<Draft>();
  const [opening, setOpening] = useState(false);
  const report = (issue: unknown) => setError(errorMessage(issue));

  async function protectDraft(action: () => void | Promise<void>) {
    if (!hydrated || saving) return;
    setSaving(true);
    try {
      await saveSnapshot(draft);
      await action();
    } catch (issue) {
      setError(`Could not save the current draft. ${errorMessage(issue)}`);
    } finally {
      setSaving(false);
    }
  }

  async function showLibrary() {
    setSnapshots(await listSnapshots());
    setDialog('library');
  }

  function replaceDraft(next: Draft) {
    return protectDraft(() => {
      setIncoming(undefined);
      setDraft(next);
      select(next.scenes[0].id);
      setError('');
      setDialog(undefined);
    });
  }

  async function importDraft(read: (module: ProjectImport) => Promise<Draft>, closeOnFailure: boolean) {
    setOpening(true);
    setError('');
    try {
      setIncoming(await read(await import('./project-import.ts')));
      setDialog('import');
    } catch (issue) {
      report(issue);
      if (closeOnFailure) setDialog(undefined);
    } finally {
      setOpening(false);
    }
  }

  return {
    snapshots,
    saving,
    incoming,
    opening,
    replaceDraft,
    saveCopy: () => void protectDraft(showLibrary),
    openLibrary: () => void showLibrary().catch(report),
    removeSnapshot: (id: string) => void deleteSnapshot(id).then(showLibrary).catch(report),
    downloadDraft: () =>
      void import('./draft-file.ts').then(({downloadDraft}) => downloadDraft(draft)).catch(report),
    async openDraftFile(file?: File) {
      if (!file) return;
      try {
        const {openDraftFile} = await import('./draft-file.ts');
        setIncoming(await openDraftFile(file));
        setDialog('import');
      } catch (issue) {
        report(issue);
      }
    },
    openFolder: (files: File[]) =>
      files.length ? importDraft(({importFolder}) => importFolder(files), false) : undefined,
    openGenerated: (id: string) => importDraft(({importJob}) => importJob(id), true),
    closeIncoming() {
      setIncoming(undefined);
      setDialog(undefined);
    },
  };
}

export type ProjectLibrary = ReturnType<typeof useProjectLibrary>;
