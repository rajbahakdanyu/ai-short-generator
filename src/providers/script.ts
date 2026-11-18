import {z} from 'zod';
import type {RemoteConfig} from './config.ts';
import {geminiParts, request} from './http.ts';

const blocks = z.array(z.object({text: z.string().optional()}));

export async function generateScript(config: RemoteConfig, system: string, topic: string) {
  const {provider, model} = config;
  if (provider === 'anthropic') {
    const response = await request(config, '/messages', {
      model,
      system,
      max_tokens: 3000,
      messages: [{role: 'user', content: topic}],
    });
    return z
      .object({content: blocks})
      .parse(await response.json())
      .content.map(({text}) => text)
      .join('');
  }
  if (provider === 'google') {
    const parts = await geminiParts(config, {
      systemInstruction: {parts: [{text: system}]},
      contents: [{role: 'user', parts: [{text: topic}]}],
      generationConfig: {responseMimeType: 'application/json'},
    });
    return parts
      .filter((part) => !part.thought)
      .map(({text}) => text)
      .join('');
  }
  if (provider === 'bedrock') {
    const response = await request(config, `/model/${encodeURIComponent(model)}/converse`, {
      system: [{text: system}],
      messages: [{role: 'user', content: [{text: topic}]}],
      inferenceConfig: {maxTokens: 3000},
    });
    const schema = z.object({output: z.object({message: z.object({content: blocks})})});
    return schema
      .parse(await response.json())
      .output.message.content.map(({text}) => text)
      .join('');
  }

  const response = await request(config, provider === 'cohere' ? '/chat' : '/chat/completions', {
    model,
    messages: [
      {role: 'system', content: system},
      {role: 'user', content: topic},
    ],
  });
  if (provider === 'cohere') {
    const schema = z.object({message: z.object({content: blocks})});
    return schema
      .parse(await response.json())
      .message.content.map(({text}) => text)
      .join('');
  }
  const schema = z.object({
    choices: z.array(z.object({message: z.object({content: z.string().nullable()})})),
  });
  return schema.parse(await response.json()).choices[0]?.message.content ?? '';
}
