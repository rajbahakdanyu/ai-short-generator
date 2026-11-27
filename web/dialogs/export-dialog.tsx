import {Alert, Button, Modal, Progress} from '@mantine/core';
import {ArrowDownToLine, FolderOpen, Info} from 'lucide-react';
import {useEffect, useState} from 'react';
import {errorMessage} from '../../src/errors.ts';
import {post} from '../api.ts';
import {formatTime, type Job} from '../model.ts';

function Elapsed({since}: {since?: number}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return formatTime(since ? (now - since) / 1000 : 0);
}

export function ExportDialog({
  opened,
  close,
  job,
  setJob,
  running,
  pollError,
  opening,
  setError,
  resumePaid,
  reviewStoryboard,
  openGenerated,
}: {
  opened: boolean;
  close: () => void;
  job?: Job;
  setJob: (job: Job) => void;
  running: boolean;
  pollError: string;
  opening: boolean;
  setError: (message: string) => void;
  resumePaid: (id: string) => void;
  reviewStoryboard: (id: string) => void;
  openGenerated: (id: string) => void;
}) {
  const id = job?.id;
  const videoUrl =
    id && job.hasVideo && job.phase === 'Complete' ? `/api/studio/jobs/${id}/video` : undefined;

  function cancel(id: string) {
    if (window.confirm('Stop generation? Completed provider calls may still be charged.'))
      void post(`jobs/${id}/cancel`).catch((issue) => setError(errorMessage(issue)));
  }

  async function resume(previous: Job, id: string) {
    if (previous.resumeNeedsProviders) {
      resumePaid(id);
      return;
    }
    try {
      await post(`jobs/${id}/resume`);
      setJob({id, phase: 'Rendering video', progress: 0});
    } catch (issue) {
      setJob({...previous, error: errorMessage(issue)});
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Generation and export">
      <div aria-live="polite" className="export-status">
        <strong>{job?.phase}</strong>
        {running && job?.detail && (
          <p>
            {job.detail} · <Elapsed since={job.startedAt} /> elapsed
          </p>
        )}
        {job?.usage && (
          <div>
            Provider requests attempted: {job.usage.script} script · {job.usage.visual} visual ·{' '}
            {job.usage.voice} voice.
            {job.estimatedSpend !== undefined && (
              <p>
                Estimated spend ${job.estimatedSpend.toFixed(2)} USD of ${job.spendingLimit?.toFixed(2)} USD.
              </p>
            )}
          </div>
        )}
        {pollError && <Alert color="yellow">{pollError}</Alert>}
        {running && id && (
          <Button variant="default" onClick={() => cancel(id)}>
            Stop generation
          </Button>
        )}
        {!running && id && job.resumable && (
          <Button variant="default" onClick={() => void resume(job, id)}>
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
        {!running && id && job.hasStoryboard && (
          <Button variant="default" onClick={() => reviewStoryboard(id)}>
            Review and edit storyboard
          </Button>
        )}
        {!running && id && job.hasDraft && !job.hasStoryboard && (
          <Button
            variant="default"
            loading={opening}
            leftSection={<FolderOpen size={16} />}
            onClick={() => openGenerated(id)}
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
  );
}
