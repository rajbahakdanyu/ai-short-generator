import {
  Button,
  FileInput,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {Sparkles} from 'lucide-react';
import {type Dispatch, type SetStateAction, useState} from 'react';
import {defaultKokoroVoice, kokoroVoices} from '../src/kokoro-voices.ts';
import {
  imageProviders,
  type PaidSelection,
  scriptProviders,
  voiceProviders,
} from '../src/providers/catalog.ts';

export type PaidInput = {topic: string; mode: 'plan' | 'prepare' | 'export'; selection: PaidSelection};

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

export function PaidDialog({
  opened,
  close,
  submit,
  selection,
  setSelection,
}: {
  opened: boolean;
  close: () => void;
  submit: (input: PaidInput, track?: File) => void;
  selection: PaidSelection;
  setSelection: Dispatch<SetStateAction<PaidSelection>>;
}) {
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<PaidInput['mode']>('plan');
  const [soundtrack, setSoundtrack] = useState<File | null>(null);
  const visible: (keyof PaidSelection)[] = mode === 'plan' ? ['script'] : ['script', 'image', 'voice'];
  const missingEndpointKey = visible.some((stage) => {
    const choice = selection[stage];
    if (choice?.provider === 'kokoro') return false;
    return choice?.baseUrl?.trim() && !choice.apiKey?.trim();
  });

  function update<K extends keyof PaidSelection>(stage: K, patch: NonNullable<PaidSelection[K]>) {
    setSelection((previous) => ({...previous, [stage]: {...previous[stage], ...patch}}));
  }

  const clean = (stage: keyof PaidSelection) => ({
    provider: selection[stage]?.provider,
    model: selection[stage]?.model?.trim() || undefined,
    apiKey: selection[stage]?.apiKey?.trim() || undefined,
    baseUrl: selection[stage]?.baseUrl?.trim() || undefined,
  });

  return (
    <Modal opened={opened} onClose={close} title="Generate from a topic" size="lg" centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!topic.trim() || missingEndpointKey) return;
          submit(
            {
              topic: topic.trim(),
              mode,
              selection: {
                script: clean('script'),
                image:
                  mode === 'plan'
                    ? undefined
                    : {
                        ...clean('image'),
                        size: selection.image?.size?.trim() || undefined,
                        aspectRatio: selection.image?.aspectRatio?.trim() || undefined,
                        options: selection.image?.options?.trim() || undefined,
                      },
                voice:
                  mode === 'plan'
                    ? undefined
                    : {
                        ...clean('voice'),
                        voice: selection.voice?.voice?.trim() || undefined,
                        format: selection.voice?.format || undefined,
                      },
              },
            },
            mode === 'plan' ? undefined : (soundtrack ?? undefined),
          );
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Topic"
            placeholder="Why do black holes look bright?"
            value={topic}
            maxLength={4000}
            onChange={(event) => setTopic(event.currentTarget.value)}
          />
          <Select
            label="What to generate"
            value={mode}
            allowDeselect={false}
            data={[
              {value: 'plan', label: 'Storyboard only'},
              {value: 'prepare', label: 'Storyboard, images and narration'},
              {value: 'export', label: 'Full Short with MP4 export'},
            ]}
            onChange={(choice) => {
              if (choice === 'plan' || choice === 'prepare' || choice === 'export') setMode(choice);
            }}
          />
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
                        data={Object.entries(kokoroVoices).map(([value, name]) => ({value, label: name}))}
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
                            !!choice?.baseUrl?.trim() &&
                            !choice.apiKey?.trim() &&
                            'Enter a key for this endpoint'
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
          {mode !== 'plan' && (
            <FileInput
              label="Soundtrack"
              placeholder="Choose optional background audio"
              clearable
              accept="audio/*"
              value={soundtrack}
              onChange={setSoundtrack}
            />
          )}
          <Text size="sm" c="dimmed">
            Keys you enter stay in this tab until you reload it. Blank fields use configured defaults. The
            selected providers may charge for this run.
          </Text>
          <Group justify="space-between">
            <Button
              variant="subtle"
              color="gray"
              disabled={Object.keys(selection).length === 0}
              onClick={() => setSelection({})}
            >
              Clear overrides
            </Button>
            <Group>
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="primary"
                leftSection={<Sparkles size={16} />}
                disabled={!topic.trim() || missingEndpointKey}
              >
                {mode === 'plan'
                  ? 'Generate storyboard'
                  : mode === 'prepare'
                    ? 'Prepare scenes'
                    : 'Generate and export'}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
