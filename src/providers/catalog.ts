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

type StageSelection = {provider?: string; model?: string; apiKey?: string; baseUrl?: string};

export type PaidSelection = {
  script?: StageSelection;
  image?: StageSelection & {size?: string; aspectRatio?: string; options?: string};
  voice?: StageSelection & {voice?: string; format?: string};
};
