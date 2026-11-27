import {errorMessage} from '../src/errors.ts';
import {type Job, saveJob} from './jobs.ts';

export type JobTask = (signal: AbortSignal) => Promise<void>;
export type PendingJob = {id: string; job: Job; task: JobTask};

export function createJobRunner() {
  let active: {id: string; job: Job; controller: AbortController} | undefined;
  let busy = false;

  function stoppedMessage(job: Job) {
    return job.paid
      ? 'Generation stopped. Provider calls already submitted may still be charged.'
      : 'Generation stopped.';
  }

  return {
    get activeId() {
      return active?.id;
    },
    activeJob(id: string) {
      return active?.id === id ? active.job : undefined;
    },
    cancel(id: string) {
      if (active?.id !== id) return false;
      active.controller.abort();
      return true;
    },
    /** Reserves the single generation slot shared by exports, paid and local runs, and voice previews. */
    claim() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      busy = false;
    },
    /** Runs a claimed job in the background; the slot is released once its final status is saved. */
    start({id, job, task}: PendingJob) {
      const controller = new AbortController();
      active = {id, job, controller};
      void task(controller.signal)
        .then(() => {
          controller.signal.throwIfAborted();
          job.phase = 'Complete';
          job.progress = 1;
        })
        .catch((error: unknown) => {
          const aborted = controller.signal.aborted;
          job.phase = aborted ? 'Cancelled' : 'Failed';
          job.error = aborted ? stoppedMessage(job) : errorMessage(error);
        })
        .finally(async () => {
          try {
            await saveJob(id, job);
          } finally {
            active = undefined;
            busy = false;
          }
        })
        .catch((error) => console.error('Could not save Studio job status', error));
      return id;
    },
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
