export const scriptProviders = [
  'openai',
  'compatible',
  'openrouter',
  'anthropic',
  'google',
  'xai',
  'azure',
  'bedrock',
  'mistral',
  'groq',
  'deepseek',
  'together',
  'fireworks',
  'perplexity',
  'deepinfra',
  'cerebras',
  'cohere',
  'gateway',
] as const;
export const imageProviders = [
  'openai',
  'compatible',
  'openrouter',
  'google',
  'xai',
  'azure',
  'together',
  'fal',
  'replicate',
] as const;
export const voiceProviders = [
  'openai',
  'compatible',
  'openrouter',
  'google',
  'xai',
  'azure',
  'elevenlabs',
] as const;

export type PaidSelection = {
  script?: {provider?: string; model?: string};
  image?: {provider?: string; model?: string};
  voice?: {provider?: string; model?: string; voice?: string};
};
