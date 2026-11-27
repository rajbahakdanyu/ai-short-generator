import {get, set, update} from 'idb-keyval';
import {useCallback, useEffect, useReducer, useState} from 'react';
import {sampleDraft} from './assets.ts';
import type {Draft} from './model.ts';

const activeKey = 'short-studio-draft';
const libraryKey = 'short-studio-projects';
export type Snapshot = {id: string; savedAt: number; draft: Draft};

type History = {draft: Draft; past: Draft[]; future: Draft[]};
type Action =
  | {type: 'load'; draft: Draft}
  | {type: 'edit'; update: Draft | ((draft: Draft) => Draft)}
  | {type: 'undo'}
  | {type: 'redo'};

function reducer(state: History, action: Action): History {
  switch (action.type) {
    case 'load':
      return {draft: action.draft, past: [], future: []};
    case 'edit': {
      const draft = typeof action.update === 'function' ? action.update(state.draft) : action.update;
      if (draft === state.draft) return state;
      return {draft, past: [...state.past.slice(-49), state.draft], future: []};
    }
    case 'undo': {
      const draft = state.past.at(-1);
      return draft ? {draft, past: state.past.slice(0, -1), future: [state.draft, ...state.future]} : state;
    }
    case 'redo': {
      const [draft, ...future] = state.future;
      return draft ? {draft, past: [...state.past, state.draft], future} : state;
    }
  }
}

export function useDraft() {
  const [history, dispatch] = useReducer(reducer, {draft: sampleDraft, past: [], future: []});
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const {draft} = history;

  useEffect(() => {
    let active = true;
    void get<Draft>(activeKey)
      .then((saved) => {
        if (active && saved?.scenes.length) dispatch({type: 'load', draft: saved});
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
    void set(activeKey, draft).then(
      () => setSaveError(false),
      () => setSaveError(true),
    );
  }, [draft, hydrated]);

  const setDraft = useCallback(
    (update: Draft | ((draft: Draft) => Draft)) => dispatch({type: 'edit', update}),
    [],
  );
  const undo = useCallback(() => dispatch({type: 'undo'}), []);
  const redo = useCallback(() => dispatch({type: 'redo'}), []);
  return {
    draft,
    hydrated,
    saveError,
    setDraft,
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
    undo,
    redo,
  };
}

export async function saveSnapshot(draft: Draft) {
  const snapshot = {id: crypto.randomUUID(), savedAt: Date.now(), draft};
  await update<Snapshot[]>(libraryKey, (items) => [snapshot, ...(items ?? [])]);
}

export async function listSnapshots() {
  return (await get<Snapshot[]>(libraryKey)) ?? [];
}

export async function deleteSnapshot(id: string) {
  await update<Snapshot[]>(libraryKey, (items) => (items ?? []).filter((item) => item.id !== id));
}
