import {rm} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
import {z} from 'zod';
import {readOptional, writeAtomic} from '../checkpoint.ts';
import {downloadAsset} from './asset-download.ts';
import type {RemoteConfig} from './config.ts';
import {ProviderHttpError, readProviderJson, request} from './http.ts';

const videoModel = 'fal-ai/wan/v2.7/text-to-video';
const requestId = z.uuid();
const queueStatus = z.object({
  status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
  error: z.string().nullish(),
});

export async function generateClip(
  apiKey: string,
  prompt: string,
  checkpoint: string,
  {
    signal,
    report,
    beforeSubmit,
  }: {
    signal?: AbortSignal;
    report?: (status: string) => Promise<void> | undefined;
    beforeSubmit?: () => Promise<void> | undefined;
  },
) {
  const timeout = AbortSignal.timeout(20 * 60_000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const config: RemoteConfig = {
    apiKey,
    provider: 'fal',
    endpoint: 'https://queue.fal.run',
    model: videoModel,
    officialOpenAi: false,
    signal,
  };
  const saved = await readOptional(checkpoint);
  let id: string;
  if (saved) id = requestId.parse(saved.toString());
  else {
    await beforeSubmit?.();
    const response = await request(config, `/${videoModel}`, {
      prompt,
      aspect_ratio: '9:16',
      resolution: '720p',
      duration: 5,
    });
    id = z.object({request_id: requestId}).parse(await readProviderJson(response, 1024 * 1024)).request_id;
    await writeAtomic(checkpoint, id);
  }

  const resource = `/fal-ai/wan/requests/${id}`;
  async function getQueueResource(path: string) {
    try {
      return await request(config, path);
    } catch (error) {
      if (error instanceof ProviderHttpError && [404, 410].includes(error.status)) {
        await rm(checkpoint, {force: true});
        throw new Error(
          `Saved fal request ${id} is no longer available. Resume again to submit a new request.`,
        );
      }
      throw error;
    }
  }
  for (;;) {
    const response = await getQueueResource(`${resource}/status`);
    const status = queueStatus.parse(await readProviderJson(response, 1024 * 1024));
    if (status.status === 'COMPLETED') {
      if (status.error) {
        await rm(checkpoint, {force: true});
        throw new Error(`fal video generation failed (request ${id}).`);
      }
      break;
    }
    await report?.(status.status === 'IN_QUEUE' ? 'video queued at fal' : 'fal is rendering video');
    await setTimeout(4000, undefined, {signal});
  }

  const response = await getQueueResource(resource);
  const {video} = z
    .object({video: z.object({url: z.string()})})
    .parse(await readProviderJson(response, 1024 * 1024));
  return downloadAsset(video.url, signal);
}
