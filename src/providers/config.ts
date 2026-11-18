import {loadEnvFile} from 'node:process';

export const setting = (name: string) => process.env[name]?.trim() || undefined;

const providers = {
  openai: ['OPENAI_API_KEY', 'https://api.openai.com/v1'],
  compatible: ['OPENAI_API_KEY', undefined],
  openrouter: ['OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1'],
  anthropic: ['ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1'],
  google: ['GOOGLE_API_KEY', 'https://generativelanguage.googleapis.com/v1beta'],
  xai: ['XAI_API_KEY', 'https://api.x.ai/v1'],
  azure: ['AZURE_OPENAI_API_KEY', undefined],
  bedrock: ['AWS_BEARER_TOKEN_BEDROCK', undefined],
  mistral: ['MISTRAL_API_KEY', 'https://api.mistral.ai/v1'],
  groq: ['GROQ_API_KEY', 'https://api.groq.com/openai/v1'],
  deepseek: ['DEEPSEEK_API_KEY', 'https://api.deepseek.com/v1'],
  together: ['TOGETHER_API_KEY', 'https://api.together.ai/v1'],
  fireworks: ['FIREWORKS_API_KEY', 'https://api.fireworks.ai/inference/v1'],
  perplexity: ['PERPLEXITY_API_KEY', 'https://api.perplexity.ai'],
  deepinfra: ['DEEPINFRA_API_KEY', 'https://api.deepinfra.com/v1/openai'],
  cerebras: ['CEREBRAS_API_KEY', 'https://api.cerebras.ai/v1'],
  cohere: ['COHERE_API_KEY', 'https://api.cohere.com/v2'],
  gateway: ['AI_GATEWAY_API_KEY', 'https://ai-gateway.vercel.sh/v1'],
  fal: ['FAL_KEY', 'https://fal.run'],
  replicate: ['REPLICATE_API_TOKEN', 'https://api.replicate.com/v1'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'https://api.elevenlabs.io/v1'],
} as const;

type Provider = keyof typeof providers;
type Stage = 'SCRIPT' | 'IMAGE' | 'VOICE';

const scriptProviders = [
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
const imageProviders = [
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
const voiceProviders = [
  'openai',
  'compatible',
  'openrouter',
  'google',
  'xai',
  'azure',
  'elevenlabs',
] as const;

const openAiDefaults = {SCRIPT: 'gpt-4.1-mini', IMAGE: 'gpt-image-1-mini', VOICE: 'gpt-4o-mini-tts'};

function required(name: string, value = setting(name)) {
  if (!value) throw new Error(`Set ${name} for the selected provider.`);
  return value;
}

function endpointFor(provider: Provider, stage: Stage) {
  const override = setting(`${stage}_BASE_URL`);
  if (override) return override;
  if (provider === 'openai' || provider === 'compatible') {
    return setting('OPENAI_BASE_URL') ?? providers[provider][1];
  }
  if (provider === 'azure') return required('AZURE_OPENAI_BASE_URL');
  if (provider === 'bedrock') {
    const region = required('AWS_REGION', setting('AWS_REGION') ?? setting('AWS_DEFAULT_REGION'));
    if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region))
      throw new Error('AWS_REGION must be a valid region name.');
    const domain = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
    return `https://bedrock-runtime.${region}.${domain}`;
  }
  return providers[provider][1];
}

function stageConfig<P extends Provider>(stage: Stage, allowed: readonly P[], selected: string) {
  const provider = allowed.find((candidate) => candidate === selected);
  if (!provider) {
    throw new Error(
      `${stage}_PROVIDER "${selected}" is unsupported. Choose ${allowed.join(', ')}${stage === 'VOICE' ? ', or kokoro' : ''}.`,
    );
  }

  const endpoint = new URL(required(`${stage}_BASE_URL`, endpointFor(provider, stage)));
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      `${stage}_BASE_URL must be an HTTP(S) API base URL without credentials, query, or fragment.`,
    );
  }

  const [keyName] = providers[provider];
  const apiKey = required(
    keyName,
    setting(`${stage}_API_KEY`) ??
      setting(keyName) ??
      (provider === 'google' ? setting('GEMINI_API_KEY') : undefined),
  );
  const officialOpenAi = provider === 'openai' && endpoint.origin === 'https://api.openai.com';
  const model =
    provider === 'xai' && stage === 'VOICE'
      ? 'tts'
      : required(
          `${stage}_MODEL`,
          setting(`${stage}_MODEL`) ?? (officialOpenAi ? openAiDefaults[stage] : undefined),
        );
  return {provider, endpoint: endpoint.href.replace(/\/$/, ''), apiKey, model, officialOpenAi};
}

function voiceConfig(selected: string) {
  if (selected === 'kokoro') return {provider: 'kokoro'} as const;
  const config = stageConfig('VOICE', voiceProviders, selected);
  return {
    ...config,
    voice: required('VOICE', setting('VOICE') ?? (config.officialOpenAi ? 'onyx' : undefined)),
  };
}

export function paidProviders(planOnly: boolean) {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const common = setting('PAID_PROVIDER') ?? 'openai';
  const script = stageConfig('SCRIPT', scriptProviders, setting('SCRIPT_PROVIDER') ?? common);
  if (planOnly) return {script};
  return {
    script,
    image: stageConfig('IMAGE', imageProviders, setting('IMAGE_PROVIDER') ?? common),
    voice: voiceConfig(setting('VOICE_PROVIDER') ?? common),
  };
}

export type PaidProviders = ReturnType<typeof paidProviders>;
export type RemoteConfig = {
  provider: Provider;
  endpoint: string;
  apiKey: string;
  model: string;
  officialOpenAi: boolean;
};
