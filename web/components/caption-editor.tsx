import {Button, NumberInput, TextInput} from '@mantine/core';
import {ChevronDown} from 'lucide-react';
import {captionIssue, FPS, maxCaptions} from '../../src/project.ts';
import {captionsFor, type DraftScene, framesFor} from '../model.ts';

type Cue = ReturnType<typeof captionsFor>[number];

const replaceCue = (cues: Cue[], index: number, cue: Cue) =>
  cues.map((item, i) => (i === index ? cue : item));

function splitCue(cues: Cue[], index: number) {
  const cue = cues[index];
  const middle = (cue.start + cue.end) / 2;
  const words = cue.text.trim().split(/\s+/);
  const split = Math.ceil(words.length / 2);
  return [
    ...cues.slice(0, index),
    {...cue, end: middle, text: words.slice(0, split).join(' ')},
    {...cue, start: middle, text: words.slice(split).join(' ')},
    ...cues.slice(index + 1),
  ];
}

function mergeWithNext(cues: Cue[], index: number) {
  const [cue, next] = [cues[index], cues[index + 1]];
  return [
    ...cues.slice(0, index),
    {...cue, end: next.end, text: `${cue.text} ${next.text}`},
    ...cues.slice(index + 2),
  ];
}

export function CaptionEditor({
  scene,
  patch,
  setError,
}: {
  scene: DraftScene;
  patch: (patch: Partial<DraftScene>) => void;
  setError: (message: string) => void;
}) {
  const cues = captionsFor(scene);
  const seconds = framesFor(scene) / FPS;
  const editable = !!scene.voice && !scene.voiceOutdated;
  const setCaptions = (captions: Cue[]) => patch({captions});

  return (
    <details className="caption-panel">
      <summary>
        Captions{' '}
        <span>
          {cues.length} cues <ChevronDown size={13} />
        </span>
      </summary>
      {!editable && <p>Generate narration before editing caption timing.</p>}
      {editable &&
        cues.map((cue, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Caption slots stay in order, and their text and timing are editable.
          <div className="caption-edit" key={i}>
            <TextInput
              aria-label={`Caption ${i + 1}`}
              value={cue.text}
              error={!cue.text.trim()}
              onChange={(event) =>
                setCaptions(replaceCue(cues, i, {...cue, text: event.currentTarget.value}))
              }
            />
            <div>
              {(['start', 'end'] as const).map((edge) => (
                <NumberInput
                  key={edge}
                  label={edge === 'start' ? 'Start (s)' : 'End (s)'}
                  aria-label={`Caption ${i + 1} ${edge}`}
                  hideControls
                  error={edge === 'end' ? captionIssue(cues, i, framesFor(scene)) : undefined}
                  decimalScale={2}
                  step={0.05}
                  min={0}
                  max={seconds}
                  value={cue[edge]}
                  onChange={(value) => {
                    if (typeof value === 'number') setCaptions(replaceCue(cues, i, {...cue, [edge]: value}));
                  }}
                />
              ))}
            </div>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setCaptions(cues.filter((_, j) => j !== i))}
            >
              Delete cue
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={cues.length >= maxCaptions || cue.text.trim().split(/\s+/).length < 2}
              onClick={() => setCaptions(splitCue(cues, i))}
            >
              Split cue
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={!cues[i + 1]}
              onClick={() => setCaptions(mergeWithNext(cues, i))}
            >
              Merge with next
            </Button>
          </div>
        ))}
      {editable && (
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={cues.length >= maxCaptions}
          onClick={() => {
            const start = cues.at(-1)?.end ?? 0;
            if (start >= seconds) {
              setError('Shorten the last cue to make room for a new one.');
              return;
            }
            setCaptions([...cues, {start, end: seconds, text: 'New caption'}]);
          }}
        >
          Add cue
        </Button>
      )}
    </details>
  );
}
