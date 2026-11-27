import {captionIssue, maxCaptions, maxProjectFrames, maxSceneFrames, maxScenes} from '../src/project.ts';
import {type Asset, type Draft, type DraftScene, framesFor, freshScene} from './model.ts';

export function newRecording(voice: Asset, seconds: number): Partial<DraftScene> {
  return {voice, seconds, frames: undefined, captions: undefined, voiceOutdated: false};
}

export function exportSceneTiming(scene: DraftScene) {
  if (scene.voiceOutdated) return {};
  return {frames: scene.frames, captions: scene.voice ? scene.captions : undefined};
}

export function scriptScenes(script: string): DraftScene[] {
  const paragraphs = script
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length > maxScenes || paragraphs.some((part) => part.length > 4000))
    throw new Error('Scripts support 100 scenes and 4,000 narration characters per scene.');
  return paragraphs.map((part, i) => ({...freshScene(part), name: `Scene ${i + 1}`}));
}

export function exportIssue(draft: Draft) {
  const invalidCaptions = draft.scenes.some((scene) => {
    const {captions} = exportSceneTiming(scene);
    return (
      captions &&
      (captions.length > maxCaptions ||
        captions.some((_, index) => captionIssue(captions, index, framesFor(scene))))
    );
  });
  if (invalidCaptions) return 'Fix empty captions or invalid caption times';
  const frames = draft.scenes.map(framesFor);
  if (
    draft.scenes.length > maxScenes ||
    frames.some((count) => count > maxSceneFrames) ||
    frames.reduce((sum, count) => sum + count, 0) > maxProjectFrames
  )
    return 'Projects support 100 scenes, two minutes per scene and ten minutes total';
  if (!draft.title.trim() || draft.scenes.some((scene) => !scene.narration.trim() || !scene.media))
    return 'Add a title, narration and visual to each scene';
}
