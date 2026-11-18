import {useEffect, useState} from 'react';
import {ApiError, api, type Job} from './model.ts';

const lastJobKey = 'short-studio-last-job';
export const jobRunning = (job?: Job) => !!job && !['Complete', 'Failed', 'Cancelled'].includes(job.phase);
export const mutationHeaders = {'X-Short-Studio': '1'};
export const jsonHeaders = {...mutationHeaders, 'Content-Type': 'application/json'};

export function useStudioJobs() {
  const [job, setJob] = useState<Job | undefined>(() => {
    try {
      const id = sessionStorage.getItem(lastJobKey);
      if (id) return {id, phase: 'Preparing scenes', progress: 0};
    } catch {
      // Job results remain discoverable on disk.
    }
  });
  const [pollError, setPollError] = useState('');
  const id = job?.id;
  const running = jobRunning(job);

  useEffect(() => {
    try {
      if (id) sessionStorage.setItem(lastJobKey, id);
      else sessionStorage.removeItem(lastJobKey);
    } catch {
      // Job results remain discoverable on disk.
    }
  }, [id]);

  useEffect(() => {
    setPollError('');
    if (!id || !running) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const progress: Job = await (
          await api(`jobs/${id}`, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])})
        ).json();
        if (!active) return;
        setPollError('');
        setJob({...progress, id});
        if (jobRunning(progress)) timer = setTimeout(poll, 500);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 404) {
          setJob({phase: 'Failed', progress: 0, error: 'That job is no longer available.'});
          return;
        }
        setPollError('Connection interrupted. Retrying…');
        timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, running]);

  return {job, setJob, running, pollError};
}
