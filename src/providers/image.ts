import {setTimeout} from 'node:timers/promises';
import {z} from 'zod';
import {downloadAsset} from './asset-download.ts';
import type {RemoteConfig} from './config.ts';
import {geminiParts, readProviderJson, request} from './http.ts';

const imageReply = z.object({
  data: z.array(z.object({url: z.string().optional(), b64_json: z.string().optional()})),
});

async function generateReplicate(config: RemoteConfig, prompt: string, options: object) {
  const model = config.model.split('/').map(encodeURIComponent).join('/');
  const state = z.object({
    id: z.string().min(1),
    status: z.string(),
    output: z.union([z.string(), z.array(z.string())]).nullish(),
  });
  const response = await request(
    config,
    `/models/${model}/predictions`,
    {input: {...options, prompt}},
    {Prefer: 'wait=60'},
  );
  let prediction = state.parse(await readProviderJson(response));

  for (let attempt = 0; attempt < 60 && ['starting', 'processing'].includes(prediction.status); attempt++) {
    await setTimeout(2000, undefined, {signal: config.signal});
    const update = await request(config, `/predictions/${encodeURIComponent(prediction.id)}`);
    prediction = state.parse(await readProviderJson(update));
  }
  if (prediction.status !== 'succeeded')
    throw new Error(`Replicate prediction ${prediction.id} ended at status "${prediction.status}".`);
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) throw new Error('Replicate returned no image.');
  return downloadAsset(url, config.signal);
}

export async function generateImage(
  config: RemoteConfig & {options: object; aspectRatio?: string; size?: string},
  prompt: string,
) {
  const {options, size, provider, model, officialOpenAi} = config;
  const aspect = config.aspectRatio ?? '9:16';
  if (provider === 'google') {
    if (model.replace(/^models\//, '').startsWith('imagen-')) {
      const id = encodeURIComponent(model.replace(/^models\//, ''));
      const response = await request(config, `/models/${id}:predict`, {
        instances: [{prompt}],
        parameters: {sampleCount: 1, aspectRatio: aspect, ...options},
      });
      const schema = z.object({predictions: z.array(z.object({bytesBase64Encoded: z.string()}))});
      const image = schema.parse(await readProviderJson(response)).predictions[0]?.bytesBase64Encoded;
      if (!image) throw new Error('Imagen returned no image.');
      return Buffer.from(image, 'base64');
    }
    const parts = await geminiParts(config, {
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {responseModalities: ['IMAGE'], imageConfig: {aspectRatio: aspect}, ...options},
    });
    const image = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'))?.inlineData;
    if (!image) throw new Error('Gemini returned no image.');
    return Buffer.from(image.data, 'base64');
  }
  if (provider === 'fal') {
    const path = model.split('/').map(encodeURIComponent).join('/');
    const shape = model.startsWith('xai/') ? {aspect_ratio: aspect} : {};
    const response = await request(config, `/${path}`, {...shape, ...options, prompt});
    const schema = z.object({images: z.array(z.object({url: z.string()}))});
    const url = schema.parse(await readProviderJson(response)).images[0]?.url;
    if (!url) throw new Error('fal returned no image.');
    return downloadAsset(url, config.signal);
  }
  if (provider === 'replicate') return generateReplicate(config, prompt, options);

  const params =
    officialOpenAi && model.startsWith('gpt-image')
      ? {size: size ?? '1024x1536', quality: 'medium', output_format: 'jpeg'}
      : size
        ? {size}
        : {};
  const dimensions = provider === 'xai' || provider === 'openrouter' ? {aspect_ratio: aspect} : {};
  const response = await request(config, provider === 'openrouter' ? '/images' : '/images/generations', {
    ...params,
    ...dimensions,
    ...options,
    model,
    prompt,
  });
  const result = imageReply.parse(await readProviderJson(response)).data[0];
  if (result?.b64_json) return Buffer.from(result.b64_json, 'base64');
  if (result?.url) return downloadAsset(result.url, config.signal);
  throw new Error(`${provider} returned no image.`);
}
