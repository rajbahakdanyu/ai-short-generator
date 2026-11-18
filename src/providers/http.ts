import {z} from 'zod';
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

export async function request(
  config: RemoteConfig,
  path: string,
  body?: object,
  headers?: Record<string, string>,
) {
  let response: Response;
  try {
    response = await fetch(`${config.endpoint}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {...auth(config), ...(body && {'content-type': 'application/json'}), ...headers},
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
      redirect: 'error',
    });
  } catch {
    throw new Error(`Could not reach ${config.provider} for ${path}. Check the base URL and connection.`);
  }
  if (!response.ok) {
    throw new Error(
      `${config.provider} ${path} returned HTTP ${response.status}. Check the key, model access, and provider limits.`,
    );
  }
  return response;
}

export async function downloadAsset(url: string) {
  if (!['http:', 'https:'].includes(new URL(url).protocol))
    throw new Error('Provider returned an unsupported asset URL.');
  const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`Could not download generated asset (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
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
  return schema.parse(await response.json()).candidates?.[0]?.content?.parts ?? [];
}
