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
  TextInput,
} from '@mantine/core';
import {Sparkles} from 'lucide-react';
import {type Dispatch, type SetStateAction, useState} from 'react';
import type {PaidSelection} from '../../src/providers/catalog.ts';
import type {Draft, PaidInput} from '../model.ts';
import {cleanSelection, missingEndpointKey, ProviderFields, type Stage} from './provider-fields.tsx';

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
  const visible: Stage[] = resume
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
  const keyMissing = missingEndpointKey(selection, visible);

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={resume ? 'Resume generation' : 'Generate from a topic'}
      size="lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || keyMissing) return;
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
              selection: cleanSelection(selection, visible),
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
          <ProviderFields visible={visible} selection={selection} setSelection={setSelection} />
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
                disabled={!ready || keyMissing}
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
