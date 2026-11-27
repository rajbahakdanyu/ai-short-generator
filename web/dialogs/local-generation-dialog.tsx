import {Button, Checkbox, Modal, NativeSelect, NumberInput, Tabs, Textarea, TextInput} from '@mantine/core';
import {kokoroVoices} from '../../src/kokoro-voices.ts';
import {localModelDefaults} from '../../src/local-settings.ts';
import type {LocalGeneration} from '../local-generation-state.ts';

type Settings = LocalGeneration['settings'];
type SetSettings = LocalGeneration['setSettings'];

const voiceOptions = Object.entries(kokoroVoices).map(([value, label]) => ({value, label}));
const formatOptions = [
  {value: 'illustrated', label: 'Illustrated Short'},
  {value: 'animated', label: 'Animated explainer · moving diagrams'},
];
const audienceOptions = [
  {value: 'general', label: 'General audience'},
  {value: 'beginner', label: 'Beginner'},
  {value: 'intermediate', label: 'Intermediate'},
];
const presetOptions = [
  {value: 'turbo', label: 'SD-Turbo'},
  {value: 'standard', label: 'Standard Stable Diffusion'},
  {value: 'sdxl', label: 'Standard SDXL'},
];

function ModelInput({
  field,
  label,
  settings,
  setSettings,
}: {
  field: keyof typeof localModelDefaults;
  label: string;
  settings: Settings;
  setSettings: SetSettings;
}) {
  return (
    <TextInput
      label={label}
      placeholder={localModelDefaults[field]}
      value={settings[field] ?? localModelDefaults[field]}
      onChange={(event) => setSettings({...settings, [field]: event.currentTarget.value})}
      onBlur={() => {
        if (!settings[field]?.trim()) setSettings({...settings, [field]: localModelDefaults[field]});
      }}
    />
  );
}

function ShortSettings({local, busy}: {local: LocalGeneration; busy: boolean}) {
  const {settings, setSettings, topic, factChecked} = local;
  const illustrated = settings.format !== 'animated';
  const disabled = !topic.trim() || !factChecked || (illustrated && !settings.style.trim()) || busy;
  return (
    <div className="local-short-form">
      <NativeSelect
        label="Video format"
        data={formatOptions}
        value={settings.format ?? 'illustrated'}
        onChange={(event) =>
          setSettings({...settings, format: event.currentTarget.value as Settings['format']})
        }
      />
      <Textarea
        label="Topic"
        value={topic}
        maxLength={500}
        placeholder="How do fireflies glow?"
        onChange={(event) => local.setTopic(event.currentTarget.value)}
      />
      <div className="generation-pair">
        <NativeSelect
          label="Scenes"
          data={['1', '2', '3', '4', '5', '6']}
          value={settings.scenes}
          onChange={(event) => setSettings({...settings, scenes: Number(event.currentTarget.value)})}
        />
        <NumberInput
          label="Target duration (seconds)"
          min={15}
          max={180}
          value={settings.targetDurationSeconds ?? 45}
          onChange={(value) =>
            setSettings({...settings, targetDurationSeconds: typeof value === 'number' ? value : 45})
          }
        />
      </div>
      <div className="generation-pair">
        <NativeSelect
          label="Narrator"
          data={voiceOptions}
          value={settings.voice}
          onChange={(event) =>
            setSettings({...settings, voice: event.currentTarget.value as Settings['voice']})
          }
        />
        <NativeSelect
          label="Audience"
          data={audienceOptions}
          value={settings.audience ?? 'general'}
          onChange={(event) =>
            setSettings({...settings, audience: event.currentTarget.value as Settings['audience']})
          }
        />
      </div>
      {illustrated && (
        <TextInput
          label="Illustration style"
          maxLength={150}
          value={settings.style}
          onChange={(event) => setSettings({...settings, style: event.currentTarget.value})}
        />
      )}
      <Checkbox
        label="I will fact-check the generated narration before publishing"
        description="Local models can state incorrect facts. Studio does not verify claims."
        checked={factChecked}
        onChange={(event) => local.setFactChecked(event.currentTarget.checked)}
      />
      <div className="generation-actions">
        <Button className="primary" disabled={disabled} onClick={() => void local.start(true)}>
          Create storyboard to review
        </Button>
        <Button variant="default" disabled={disabled} onClick={() => void local.start(false)}>
          Skip review and generate MP4
        </Button>
      </div>
    </div>
  );
}

function ModelSettings({settings, setSettings}: {settings: Settings; setSettings: SetSettings}) {
  const model = (field: keyof typeof localModelDefaults, label: string) => (
    <ModelInput field={field} label={label} settings={settings} setSettings={setSettings} />
  );
  return (
    <div className="generation-fields">
      <fieldset>
        <legend>Script</legend>
        {model('scriptModel', 'Instruction model (.gguf)')}
      </fieldset>
      <fieldset>
        <legend>Illustrations</legend>
        {model('imageModel', 'Diffusers model folder')}
        <NativeSelect
          label="Image generation preset"
          data={presetOptions}
          value={settings.imagePreset ?? 'turbo'}
          onChange={(event) =>
            setSettings({...settings, imagePreset: event.currentTarget.value as Settings['imagePreset']})
          }
        />
      </fieldset>
      <fieldset>
        <legend>Narration</legend>
        {model('voiceModel', 'Kokoro model (.onnx)')}
        {model('voiceBank', 'Voice bank (.bin)')}
      </fieldset>
    </div>
  );
}

export function LocalGenerationDialog({
  opened,
  close,
  local,
  busy,
}: {
  opened: boolean;
  close: () => void;
  local: LocalGeneration;
  busy: boolean;
}) {
  return (
    <Modal
      opened={opened}
      classNames={{body: 'local-generation-modal-body', content: 'local-generation-modal-content'}}
      onClose={close}
      title="Local generation"
      size="lg"
    >
      <Tabs value={local.tab} onChange={local.setTab}>
        <Tabs.List>
          <Tabs.Tab value="short">Short settings</Tabs.Tab>
          <Tabs.Tab value="models">Local models</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="short">
          <ShortSettings local={local} busy={busy} />
        </Tabs.Panel>
        <Tabs.Panel value="models">
          <ModelSettings settings={local.settings} setSettings={local.setSettings} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
