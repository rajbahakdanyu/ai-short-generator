import {PasswordInput, Select, Textarea, TextInput} from '@mantine/core';
import type {Dispatch, SetStateAction} from 'react';
import {defaultKokoroVoice, kokoroVoices} from '../../src/kokoro-voices.ts';
import {
  imageProviders,
  type PaidSelection,
  scriptProviders,
  voiceProviders,
} from '../../src/providers/catalog.ts';

export type Stage = keyof PaidSelection;
type SetSelection = Dispatch<SetStateAction<PaidSelection>>;

const envValue = 'env';
const options = (names: readonly string[]) => [
  {value: envValue, label: 'Use .env settings'},
  ...names.map((value) => ({value, label: value === 'kokoro' ? 'Kokoro (local)' : value})),
];
const stages = {
  script: {label: 'Script', providers: options(scriptProviders)},
  image: {label: 'Image', providers: options(imageProviders)},
  voice: {label: 'Voice', providers: options([...voiceProviders, 'kokoro'])},
};
const kokoroOptions = Object.entries(kokoroVoices).map(([value, label]) => ({value, label}));
const trimmed = (value?: string) => value?.trim() || undefined;

const needsKey = (choice: PaidSelection[Stage]) =>
  choice?.provider !== 'kokoro' && !!choice?.baseUrl?.trim() && !choice.apiKey?.trim();

export const missingEndpointKey = (selection: PaidSelection, visible: Stage[]) =>
  visible.some((stage) => needsKey(selection[stage]));

export function cleanSelection(selection: PaidSelection, visible: Stage[]): PaidSelection {
  const clean = (stage: Stage) => ({
    provider: selection[stage]?.provider,
    model: trimmed(selection[stage]?.model),
    apiKey: trimmed(selection[stage]?.apiKey),
    baseUrl: trimmed(selection[stage]?.baseUrl),
  });
  return {
    script: clean('script'),
    image: visible.includes('image')
      ? {
          ...clean('image'),
          size: trimmed(selection.image?.size),
          aspectRatio: trimmed(selection.image?.aspectRatio),
          options: trimmed(selection.image?.options),
        }
      : undefined,
    voice: visible.includes('voice')
      ? {
          ...clean('voice'),
          voice: trimmed(selection.voice?.voice),
          format: selection.voice?.format || undefined,
        }
      : undefined,
  };
}

export function ProviderFields({
  visible,
  selection,
  setSelection,
}: {
  visible: Stage[];
  selection: PaidSelection;
  setSelection: SetSelection;
}) {
  function update<K extends Stage>(stage: K, patch: NonNullable<PaidSelection[K]>) {
    setSelection((previous) => ({...previous, [stage]: {...previous[stage], ...patch}}));
  }

  return (
    <div className="provider-settings">
      {visible.map((stage) => {
        const {label, providers} = stages[stage];
        const choice = selection[stage];
        const localVoice = stage === 'voice' && choice?.provider === 'kokoro';
        return (
          <fieldset className="provider-block" key={stage}>
            <legend>{stage === 'voice' ? 'Narration' : label}</legend>
            <div className="provider-row">
              <Select
                label={`${label} provider`}
                searchable
                allowDeselect={false}
                value={choice?.provider ?? envValue}
                data={providers}
                onChange={(provider) =>
                  setSelection((previous) => ({
                    ...previous,
                    [stage]: {provider: provider && provider !== envValue ? provider : undefined},
                  }))
                }
              />
              {!localVoice && (stage !== 'voice' || choice?.provider !== 'xai') && (
                <TextInput
                  label={`${label} model`}
                  placeholder="Use configured model"
                  maxLength={300}
                  value={choice?.model ?? ''}
                  onChange={(event) => update(stage, {model: event.currentTarget.value})}
                />
              )}
              {localVoice && (
                <Select
                  label="Kokoro voice"
                  allowDeselect={false}
                  data={kokoroOptions}
                  value={selection.voice?.voice ?? defaultKokoroVoice}
                  onChange={(voice) => update('voice', {voice: voice ?? undefined})}
                />
              )}
              {!localVoice && (
                <>
                  <PasswordInput
                    label={`${label} API key`}
                    placeholder="Use configured API key"
                    autoComplete="off"
                    maxLength={1500}
                    value={choice?.apiKey ?? ''}
                    error={
                      !!choice?.baseUrl?.trim() && !choice.apiKey?.trim() && 'Enter a key for this endpoint'
                    }
                    onChange={(event) => update(stage, {apiKey: event.currentTarget.value})}
                  />
                  <TextInput
                    label={`${label} API base URL`}
                    placeholder="Use configured endpoint"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={1000}
                    value={choice?.baseUrl ?? ''}
                    onChange={(event) => update(stage, {baseUrl: event.currentTarget.value})}
                  />
                </>
              )}
              {stage === 'voice' && !localVoice && (
                <>
                  <TextInput
                    label="Voice ID"
                    placeholder="Use configured voice"
                    maxLength={200}
                    value={selection.voice?.voice ?? ''}
                    onChange={(event) => update('voice', {voice: event.currentTarget.value})}
                  />
                  {!['xai', 'google', 'elevenlabs'].includes(choice?.provider ?? '') && (
                    <Select
                      label="Voice output format"
                      placeholder="Use configured format"
                      clearable
                      data={['wav', 'mp3', 'flac', 'aac', 'opus', 'pcm']}
                      value={selection.voice?.format ?? null}
                      onChange={(format) => update('voice', {format: format ?? undefined})}
                    />
                  )}
                </>
              )}
            </div>
            {stage === 'image' && (
              <details className="provider-advanced">
                <summary>Image generation options</summary>
                <div className="provider-row">
                  <TextInput
                    label="Image size"
                    placeholder="e.g. 1024x1536"
                    maxLength={50}
                    value={selection.image?.size ?? ''}
                    onChange={(event) => update('image', {size: event.currentTarget.value})}
                  />
                  <TextInput
                    label="Aspect ratio"
                    placeholder="e.g. 9:16"
                    maxLength={30}
                    value={selection.image?.aspectRatio ?? ''}
                    onChange={(event) => update('image', {aspectRatio: event.currentTarget.value})}
                  />
                </div>
                <Textarea
                  label="Provider-specific options (JSON)"
                  placeholder='{"quality":"medium"}'
                  autosize
                  minRows={2}
                  maxLength={5000}
                  value={selection.image?.options ?? ''}
                  onChange={(event) => update('image', {options: event.currentTarget.value})}
                />
              </details>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
