import type {RemoteConfig} from './config.ts';
import {geminiParts, readProviderBytes, request} from './http.ts';

const direction =
  'Speak like a curious documentary host. Use natural phrasing and emphasis, with a conversational pace.';

function pcmWave(data: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(data.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export async function generateVoice(config: RemoteConfig & {voice: string; format?: string}, input: string) {
  const {provider, model, voice, officialOpenAi} = config;
  if (provider === 'google') {
    const parts = await geminiParts(config, {
      contents: [{parts: [{text: `${direction} Read this text exactly: ${input}`}]}],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}},
      },
    });
    const asset = parts.find((part) => part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
    if (!asset) throw new Error('Gemini returned no audio.');
    const data = Buffer.from(asset.data, 'base64');
    if (!/^audio\/(l16|pcm)/i.test(asset.mimeType ?? '')) return data;
    const rate = Number(asset.mimeType?.match(/rate=(\d+)/i)?.[1] ?? 24000);
    return pcmWave(data, rate);
  }

  let response: Response;
  if (provider === 'elevenlabs') {
    response = await request(
      config,
      `/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        text: input,
        model_id: model,
      },
    );
  } else if (provider === 'xai') {
    response = await request(config, '/tts', {text: input, voice_id: voice, language: 'en'});
  } else {
    const format = config.format ?? (provider === 'openrouter' ? 'mp3' : 'wav');
    response = await request(config, '/audio/speech', {
      model,
      voice,
      input,
      response_format: format,
      ...(officialOpenAi && model.startsWith('gpt-4o-mini-tts') && {instructions: direction}),
    });
    if (format === 'pcm') return pcmWave(await readProviderBytes(response), 24000);
  }
  return await readProviderBytes(response);
}
