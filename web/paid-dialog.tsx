import {Button, FileInput, Group, Modal, Select, Stack, Text, TextInput} from '@mantine/core';
import {Sparkles} from 'lucide-react';
import {useState} from 'react';
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
const scripts = options(scriptProviders);
const images = options(imageProviders);
const voices = options([...voiceProviders, 'kokoro']);

export function PaidDialog({
  opened,
  close,
  submit,
}: {
  opened: boolean;
  close: () => void;
  submit: (input: PaidInput, track?: File) => void;
}) {
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<PaidInput['mode']>('plan');
  const [soundtrack, setSoundtrack] = useState<File | null>(null);
  const [selection, setSelection] = useState<PaidSelection>({});

  const clean = (stage: keyof PaidSelection) => ({
    provider: selection[stage]?.provider,
    model: selection[stage]?.model?.trim() || undefined,
  });

  return (
    <Modal opened={opened} onClose={close} title="Generate from a topic" size="lg" centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!topic.trim()) return;
          submit(
            {
              topic: topic.trim(),
              mode,
              selection: {
                script: clean('script'),
                image: clean('image'),
                voice: {...clean('voice'), voice: selection.voice?.voice?.trim() || undefined},
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
            {(['script', 'image', 'voice'] as const)
              .filter((stage) => mode !== 'plan' || stage === 'script')
              .map((stage) => (
                <div className="provider-row" key={stage}>
                  <Select
                    label={`${stage[0].toUpperCase()}${stage.slice(1)} provider`}
                    searchable
                    allowDeselect={false}
                    value={selection[stage]?.provider ?? envValue}
                    data={stage === 'script' ? scripts : stage === 'image' ? images : voices}
                    onChange={(choice) =>
                      setSelection((previous) => ({
                        ...previous,
                        [stage]: {provider: choice && choice !== envValue ? choice : undefined},
                      }))
                    }
                  />
                  {(stage !== 'voice' || !['xai', 'kokoro'].includes(selection.voice?.provider ?? '')) && (
                    <TextInput
                      label={`${stage[0].toUpperCase()}${stage.slice(1)} model`}
                      placeholder="Use configured model"
                      maxLength={300}
                      value={selection[stage]?.model ?? ''}
                      onChange={(event) => {
                        const {value} = event.currentTarget;
                        setSelection((previous) => ({
                          ...previous,
                          [stage]: {...previous[stage], model: value},
                        }));
                      }}
                    />
                  )}
                  {stage === 'voice' && selection.voice?.provider === 'kokoro' && (
                    <Select
                      label="Kokoro voice"
                      data={Object.entries(kokoroVoices).map(([value, label]) => ({value, label}))}
                      value={selection.voice.voice ?? defaultKokoroVoice}
                      allowDeselect={false}
                      onChange={(voice) =>
                        setSelection((previous) => ({
                          ...previous,
                          voice: {...previous.voice, voice: voice ?? undefined},
                        }))
                      }
                    />
                  )}
                  {stage === 'voice' && selection.voice?.provider !== 'kokoro' && (
                    <TextInput
                      label="Voice ID"
                      placeholder="Use configured voice"
                      maxLength={200}
                      value={selection.voice?.voice ?? ''}
                      onChange={(event) => {
                        const {value} = event.currentTarget;
                        setSelection((previous) => ({...previous, voice: {...previous.voice, voice: value}}));
                      }}
                    />
                  )}
                </div>
              ))}
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
            Keys and endpoint settings come from the local .env file. The selected providers may charge for
            this run.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="primary"
              leftSection={<Sparkles size={16} />}
              disabled={!topic.trim()}
            >
              {mode === 'plan'
                ? 'Generate storyboard'
                : mode === 'prepare'
                  ? 'Prepare scenes'
                  : 'Generate and export'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
