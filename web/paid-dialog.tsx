import {
  Button,
  Checkbox,
  FileInput,
  Group,
  Modal,
  NumberInput,
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

import type {Draft} from './model.ts';

export type PaidInput = {
  topic: string;
  mode: 'plan' | 'prepare' | 'export';
  selection: PaidSelection;
  video?: boolean;
  videoKey?: string;
  board?: {
    title: string;
    scenes: Pick<Draft['scenes'][number], 'name' | 'narration' | 'imagePrompt' | 'sources'>[];
  };
  resumeLimit?: number;
  estimate?: {script: number; visual: number; voice: number; limit: number};
};

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
  resume,
  spendingLimit,
  draft,
  close,
  submit,
  selection,
  setSelection,
}: {
  opened: boolean;
  resume: boolean;
  spendingLimit?: number;
  draft: Draft;
  close: () => void;
  submit: (input: PaidInput, track?: File) => void;
  selection: PaidSelection;
  setSelection: Dispatch<SetStateAction<PaidSelection>>;
}) {
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<PaidInput['mode']>('plan');
  const [soundtrack, setSoundtrack] = useState<File | null>(null);
  const [video, setVideo] = useState(false);
  const [videoKey, setVideoKey] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [resumeLimit, setResumeLimit] = useState(spendingLimit);
  const [useBudget, setUseBudget] = useState(false);
  const [prices, setPrices] = useState({script: 0, visual: 0, voice: 0, limit: 0});
  const hasBoard =
    !!draft.title.trim() &&
    draft.scenes.length <= 8 &&
    draft.scenes.every((scene) => scene.narration.trim() && scene.imagePrompt?.trim());
  const visible: (keyof PaidSelection)[] = resume
    ? ['script', 'image', 'voice']
    : mode === 'plan'
      ? ['script']
      : video
        ? ['voice']
        : ['image', 'voice'];
  const local = selection.voice?.provider === 'kokoro';
  const estimate =
    mode === 'plan' ? prices.script : (prices.visual + (local ? 0 : prices.voice)) * draft.scenes.length;
  const overBudget = useBudget && estimate > prices.limit + 1e-8;
  const ready = resume || (!overBudget && (mode === 'plan' ? !!topic.trim() : hasBoard && reviewed));
  function priceInput(key: keyof typeof prices, label: string) {
    return (
      <NumberInput
        key={key}
        label={label}
        min={0}
        hideControls
        value={prices[key]}
        onChange={(value) => setPrices((current) => ({...current, [key]: Number(value) || 0}))}
      />
    );
  }
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
    <Modal
      opened={opened}
      onClose={close}
      title={resume ? 'Resume generation' : 'Generate from a topic'}
      size="lg"
      centered
      closeButtonProps={{'aria-label': 'Close dialog'}}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || missingEndpointKey) return;
          submit(
            {
              topic: topic.trim(),
              mode,
              video: !resume && mode !== 'plan' && video,
              videoKey: videoKey.trim() || undefined,
              board:
                !resume && mode !== 'plan'
                  ? {
                      title: draft.title,
                      scenes: draft.scenes.map(({name, narration, imagePrompt, sources}) => ({
                        name,
                        narration,
                        imagePrompt,
                        sources,
                      })),
                    }
                  : undefined,
              resumeLimit: resume ? resumeLimit : undefined,
              estimate: !resume && useBudget ? prices : undefined,
              selection: {
                script: clean('script'),
                image: !visible.includes('image')
                  ? undefined
                  : {
                      ...clean('image'),
                      size: selection.image?.size?.trim() || undefined,
                      aspectRatio: selection.image?.aspectRatio?.trim() || undefined,
                      options: selection.image?.options?.trim() || undefined,
                    },
                voice: !visible.includes('voice')
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
          {!resume && mode === 'plan' && (
            <TextInput
              label="Topic"
              placeholder="Why do black holes look bright?"
              value={topic}
              maxLength={4000}
              onChange={(event) => setTopic(event.currentTarget.value)}
            />
          )}
          {!resume && (
            <Select
              label="What to generate"
              value={mode}
              allowDeselect={false}
              data={[
                {value: 'plan', label: 'Storyboard only'},
                {value: 'prepare', label: 'Prepare the current storyboard'},
                {value: 'export', label: 'Generate from current storyboard and export MP4'},
              ]}
              onChange={(choice) => {
                if (choice === 'plan' || choice === 'prepare' || choice === 'export') setMode(choice);
              }}
            />
          )}
          {!resume && mode !== 'plan' && (
            <>
              <Text size="sm">
                {hasBoard
                  ? `Use the ${draft.scenes.length} scenes open in Studio.`
                  : 'Generate and open a storyboard with visual prompts before preparing scenes.'}
              </Text>
              <Checkbox
                label="I reviewed the storyboard and checked its educational claims"
                checked={reviewed}
                onChange={(event) => setReviewed(event.currentTarget.checked)}
              />
              <Select
                label="Visuals"
                value={video ? 'video' : 'image'}
                allowDeselect={false}
                data={[
                  {value: 'image', label: 'Still illustrations'},
                  {value: 'video', label: 'Cinematic video · fal WAN 2.7'},
                ]}
                onChange={(value) => setVideo(value === 'video')}
              />
              {video && (
                <Text size="sm">
                  Each scene requests a five-second portrait clip. Video generation can take several minutes.
                </Text>
              )}
            </>
          )}
          {(resume || (mode !== 'plan' && video)) && (
            <PasswordInput
              label="fal video API key"
              placeholder="Use FAL_KEY from .env"
              maxLength={1500}
              value={videoKey}
              onChange={(event) => setVideoKey(event.currentTarget.value)}
            />
          )}
          {resume ? (
            <Stack gap="xs">
              {spendingLimit !== undefined && (
                <NumberInput
                  label="Total estimated spending limit (USD)"
                  min={spendingLimit}
                  hideControls
                  value={resumeLimit}
                  onChange={(value) => setResumeLimit(typeof value === 'number' ? value : undefined)}
                />
              )}
              <Text size="sm">
                Select the original providers and models. Studio reuses downloaded assets and completed
                scenes.
              </Text>
            </Stack>
          ) : (
            <>
              <Text size="sm">
                {mode === 'plan'
                  ? 'One script generation request.'
                  : `${draft.scenes.length} visual requests and ${local ? 'local Kokoro narration' : `up to ${draft.scenes.length} remote voice requests`}.`}
              </Text>
              <Checkbox
                label="Use my provider prices to enforce an estimated spending limit"
                checked={useBudget}
                onChange={(event) => setUseBudget(event.currentTarget.checked)}
              />
              {useBudget ? (
                <>
                  {mode === 'plan' ? (
                    priceInput('script', 'Estimated script charge (USD)')
                  ) : (
                    <>
                      {priceInput('visual', 'Estimated visual charge per scene (USD)')}
                      {!local && priceInput('voice', 'Estimated voice charge per scene (USD)')}
                    </>
                  )}
                  {priceInput('limit', 'Estimated spending limit (USD)')}
                  <Text size="sm" c={overBudget ? 'red' : undefined}>
                    Estimated total ${estimate.toFixed(2)} USD.{' '}
                    {overBudget ? 'This exceeds your limit.' : 'Actual charges come from your provider.'}
                  </Text>
                </>
              ) : (
                <Text size="sm">Provider price unavailable. Check provider pricing before proceeding.</Text>
              )}
            </>
          )}
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
          {!resume && mode !== 'plan' && (
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
          <div className="paid-dialog-actions">
            <Button
              type="button"
              variant="subtle"
              color="gray"
              disabled={Object.keys(selection).length === 0}
              onClick={() => setSelection({})}
            >
              Clear overrides
            </Button>
            <Group className="paid-dialog-buttons">
              <Button type="button" variant="default" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="primary"
                leftSection={<Sparkles size={16} />}
                disabled={!ready || !!missingEndpointKey}
              >
                {resume
                  ? 'Resume'
                  : mode === 'plan'
                    ? 'Generate storyboard'
                    : mode === 'prepare'
                      ? 'Prepare scenes'
                      : 'Generate and export'}
              </Button>
            </Group>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}
