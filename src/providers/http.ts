import {z} from 'zod';
import {maxProviderBytes} from './asset-download.ts';
import type {RemoteConfig} from './config.ts';

function auth(config: RemoteConfig): Record<string, string> {
  switch (config.provider) {
    case 'anthropic':
      return {'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01'};
    case 'google':
      return {'x-goog-api-key': config.apiKey};
    case 'azure':
      return {'api-key': config.apiKey};
    case 'fal':
      return {authorization: `Key ${config.apiKey}`};
    case 'elevenlabs':
      return {'xi-api-key': config.apiKey};
    default:
      return {authorization: `Bearer ${config.apiKey}`};
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request(
  config: RemoteConfig,
  path: string,
  body?: object,
  headers?: Record<string, string>,
) {
  const timeout = AbortSignal.timeout(240_000);
  const signal = config.signal ? AbortSignal.any([timeout, config.signal]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${config.endpoint}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {...auth(config), ...(body && {'content-type': 'application/json'}), ...headers},
      body: body && JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  } catch {
    throw new Error(`Could not reach ${config.provider} for ${path}. Check the base URL and connection.`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderHttpError(
      response.status,
      `${config.provider} ${path} returned HTTP ${response.status}. Check the key, model access, and provider limits.`,
    );
  }
  return response;
}

export async function readProviderBytes(response: Response, limit = maxProviderBytes) {
  if (!response.body) throw new Error('Provider returned an empty body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit) throw new Error('Provider response exceeded the size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readProviderJson(response: Response, limit = maxProviderBytes): Promise<unknown> {
  return JSON.parse((await readProviderBytes(response, limit)).toString('utf8'));
}

const geminiPart = z.object({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  inlineData: z.object({data: z.string().min(1), mimeType: z.string().optional()}).optional(),
});

export async function geminiParts(config: RemoteConfig, body: object) {
  const model = encodeURIComponent(config.model.replace(/^models\//, ''));
  const response = await request(config, `/models/${model}:generateContent`, body);
  const schema = z.object({
    candidates: z.array(z.object({content: z.object({parts: z.array(geminiPart)}).optional()})).optional(),
  });
  return schema.parse(await readProviderJson(response)).candidates?.[0]?.content?.parts ?? [];
}
