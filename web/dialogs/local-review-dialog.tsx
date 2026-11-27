import {Button, Modal, NativeSelect, Textarea, TextInput} from '@mantine/core';
import type {Dispatch, SetStateAction} from 'react';
import type {LocalStoryboard} from '../../src/local-storyboard.ts';
import type {LocalReview} from '../local-generation-state.ts';

type ReviewScene = LocalStoryboard['scenes'][number];
type PatchScene = (patch: (scene: ReviewScene) => ReviewScene) => void;

const diagramLabelKeys = ['first', 'second', 'third'] as const;
const layoutOptions = [
  {value: 'pipeline', label: 'Pipeline'},
  {value: 'fan-out', label: 'Fan-out'},
  {value: 'fan-in', label: 'Fan-in'},
];

function DiagramFields({
  id,
  diagram,
  patch,
}: {
  id: string;
  diagram: Extract<ReviewScene, {diagram: unknown}>['diagram'];
  patch: PatchScene;
}) {
  const patchDiagram = (update: Partial<typeof diagram>) =>
    patch((scene) => ('diagram' in scene ? {...scene, diagram: {...scene.diagram, ...update}} : scene));
  return (
    <>
      <TextInput
        label="Diagram heading"
        maxLength={48}
        value={diagram.heading}
        onChange={(event) => patchDiagram({heading: event.currentTarget.value})}
      />
      <NativeSelect
        label="Diagram layout"
        data={layoutOptions}
        value={diagram.layout}
        onChange={(event) => {
          const layout = event.currentTarget.value;
          if (layout === 'pipeline' || layout === 'fan-out' || layout === 'fan-in') patchDiagram({layout});
        }}
      />
      <div className="generation-fields">
        {diagramLabelKeys.map((labelKey, labelIndex) => (
          <TextInput
            key={`${id}-${labelKey}`}
            label={`Diagram object ${labelIndex + 1}`}
            maxLength={22}
            value={diagram.labels[labelIndex]}
            onChange={(event) => {
              const value = event.currentTarget.value;
              patch((scene) =>
                'diagram' in scene
                  ? {
                      ...scene,
                      diagram: {
                        ...scene.diagram,
                        labels: scene.diagram.labels.map((current, i) =>
                          i === labelIndex ? value : current,
                        ),
                      },
                    }
                  : scene,
              );
            }}
          />
        ))}
      </div>
    </>
  );
}

function ReviewSceneFields({
  id,
  index,
  scene,
  animated,
  patch,
}: {
  id: string;
  index: number;
  scene: ReviewScene;
  animated: boolean;
  patch: PatchScene;
}) {
  return (
    <fieldset className="storyboard-review-scene">
      <legend>Scene {index + 1}</legend>
      <Textarea
        label="Narration"
        maxLength={4000}
        minRows={3}
        value={scene.narration}
        onChange={(event) => {
          const narration = event.currentTarget.value;
          patch((current) => ({...current, narration}));
        }}
      />
      {animated && 'diagram' in scene ? (
        <DiagramFields id={id} diagram={scene.diagram} patch={patch} />
      ) : (
        <Textarea
          label="Visual prompt"
          maxLength={4000}
          minRows={2}
          value={'imagePrompt' in scene ? scene.imagePrompt : ''}
          onChange={(event) => {
            const imagePrompt = event.currentTarget.value;
            patch((current) => ('imagePrompt' in current ? {...current, imagePrompt} : current));
          }}
        />
      )}
      <Textarea
        label="Sources and verification notes"
        maxLength={4000}
        minRows={2}
        value={scene.sources ?? ''}
        onChange={(event) => {
          const sources = event.currentTarget.value;
          patch((current) => ({...current, sources}));
        }}
      />
    </fieldset>
  );
}

export function LocalReviewDialog({
  opened,
  close,
  review,
  setReview,
  prepare,
}: {
  opened: boolean;
  close: () => void;
  review?: LocalReview;
  setReview: Dispatch<SetStateAction<LocalReview | undefined>>;
  prepare: () => void;
}) {
  function patchScene(index: number, patch: (scene: ReviewScene) => ReviewScene) {
    setReview(
      (current) =>
        current && {
          ...current,
          board: {
            ...current.board,
            scenes: current.board.scenes.map((scene, i) => (i === index ? patch(scene) : scene)),
          },
        },
    );
  }

  return (
    <Modal opened={opened} onClose={close} title="Review local storyboard" size="lg">
      {review && (
        <div className="generation-fields">
          <p className="modal-note">
            Target: about {review.targetDurationSeconds} seconds · Audience:{' '}
            {review.audience === 'general' ? 'general audience' : review.audience}. Edit the script and
            visuals before local media generation starts.
          </p>
          <TextInput
            label="Short title"
            maxLength={200}
            value={review.board.title}
            onChange={(event) => {
              const title = event.currentTarget.value;
              setReview((current) => current && {...current, board: {...current.board, title}});
            }}
          />
          {review.board.scenes.map((scene, index) => (
            <ReviewSceneFields
              key={review.sceneIds[index]}
              id={review.sceneIds[index]}
              index={index}
              scene={scene}
              animated={review.format === 'animated'}
              patch={(update) => patchScene(index, update)}
            />
          ))}
          <Button className="primary" onClick={prepare}>
            Generate visuals, narration, and MP4
          </Button>
        </div>
      )}
    </Modal>
  );
}
