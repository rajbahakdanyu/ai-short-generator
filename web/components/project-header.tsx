import {ActionIcon, Button} from '@mantine/core';
import {Check, Layers, X} from 'lucide-react';
import {formatTime, type Job} from '../model.ts';

export function WelcomePanel({
  disabled,
  start,
  dismiss,
}: {
  disabled: boolean;
  start: () => void;
  dismiss: () => void;
}) {
  return (
    <section className="welcome-panel" aria-labelledby="welcome-title">
      <div>
        <h2 id="welcome-title">Create or edit a Short</h2>
        <p>Start with a topic to create a storyboard, or press Play to explore the editor below.</p>
      </div>
      <Button className="primary" disabled={disabled} onClick={start}>
        Start with a topic
      </Button>
      <ActionIcon variant="subtle" aria-label="Dismiss getting started" onClick={dismiss}>
        <X size={16} />
      </ActionIcon>
    </section>
  );
}

export function ProjectHeader({
  title,
  setTitle,
  job,
  openJob,
  hydrated,
  saveError,
  totalSeconds,
}: {
  title: string;
  setTitle: (title: string) => void;
  job?: Job;
  openJob: () => void;
  hydrated: boolean;
  saveError: boolean;
  totalSeconds: number;
}) {
  return (
    <div className="project-header">
      <div className="project-title">
        <label htmlFor="project-title">
          <Layers size={15} /> STORYBOARD
        </label>
        <input
          id="project-title"
          aria-label="Project title"
          value={title}
          maxLength={200}
          placeholder="Untitled short"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="project-meta">
        {job && (
          <Button variant="subtle" color="gray" size="xs" onClick={openJob}>
            {job.phase}
          </Button>
        )}
        <span aria-live="polite">
          <Check size={14} />{' '}
          {saveError ? 'Draft storage unavailable' : hydrated ? 'Saved on this device' : 'Loading draft'}
        </span>
        <span className="meta-divider" />
        <strong>~{formatTime(totalSeconds)}</strong>
      </div>
    </div>
  );
}
