import {useLocalStorage} from '@mantine/hooks';
import {useState} from 'react';
import {errorMessage} from '../src/errors.ts';
import {localSettings} from '../src/local-settings.ts';
import type {LocalStoryboard} from '../src/local-storyboard.ts';
import {getJson, post, startJob} from './api.ts';
import {failedJob} from './job-state.ts';
import type {Job, StudioDialog} from './model.ts';

export type LocalTab = 'short' | 'models';
export type LocalReview = {
  id: string;
  board: LocalStoryboard;
  sceneIds: string[];
  format: 'illustrated' | 'animated';
  targetDurationSeconds: number;
  audience: 'general' | 'beginner' | 'intermediate';
};
type Manifest = LocalStoryboard & {
  settings: Pick<LocalReview, 'format' | 'targetDurationSeconds' | 'audience'>;
};

export function useLocalGeneration({
  running,
  setJob,
  setDialog,
  setError,
}: {
  running: boolean;
  setJob: (job: Job) => void;
  setDialog: (dialog?: StudioDialog) => void;
  setError: (message: string) => void;
}) {
  const [settings, setSettings] = useLocalStorage({
    key: 'short-studio-local-settings',
    defaultValue: localSettings.parse({}),
  });
  const [tab, setTab] = useState<string | null>('short');
  const [topic, setTopic] = useState('');
  const [factChecked, setFactChecked] = useState(false);
  const [review, setReview] = useState<LocalReview>();

  function open(next: LocalTab, suggestedTopic?: string) {
    if (suggestedTopic) setTopic((current) => current || suggestedTopic);
    setTab(next);
    setDialog('local');
  }

  async function start(reviewFirst: boolean) {
    setJob({phase: 'Preparing scenes', progress: 0});
    setDialog('export');
    try {
      const id = await startJob('local', {
        mode: reviewFirst ? 'plan' : 'direct',
        topic,
        ...settings,
        style: settings.style.trim() || undefined,
      });
      setJob({id, phase: 'Preparing scenes', progress: 0});
    } catch (issue) {
      setJob(failedJob(issue));
    }
  }

  async function openReview(id: string) {
    if (review?.id === id) {
      setDialog('local-review');
      return;
    }
    try {
      const {manifest} = await getJson<{manifest: Manifest}>(`jobs/${id}/draft`);
      setReview({
        id,
        board: {title: manifest.title, scenes: manifest.scenes},
        sceneIds: manifest.scenes.map(() => crypto.randomUUID()),
        format: manifest.settings.format,
        targetDurationSeconds: manifest.settings.targetDurationSeconds,
        audience: manifest.settings.audience,
      });
      setDialog('local-review');
    } catch (issue) {
      setError(errorMessage(issue));
    }
  }

  async function prepareReview() {
    if (!review || running) return;
    setDialog('export');
    try {
      await post('local', {mode: 'prepare', planId: review.id, board: review.board});
      setJob({id: review.id, phase: 'Preparing scenes', progress: 0});
      setReview(undefined);
    } catch (issue) {
      setJob(failedJob(issue, {id: review.id, hasStoryboard: true}));
    }
  }

  return {
    settings,
    setSettings,
    tab,
    setTab,
    topic,
    setTopic,
    factChecked,
    setFactChecked,
    review,
    setReview,
    open,
    start,
    openReview,
    prepareReview,
  };
}

export type LocalGeneration = ReturnType<typeof useLocalGeneration>;
