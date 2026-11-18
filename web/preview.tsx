import {ActionIcon, SegmentedControl} from '@mantine/core';
import {Player, type PlayerRef} from '@remotion/player';
import {Captions, Film} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {type PlaybackProps, Short, shortHeight, shortWidth} from '../src/composition.tsx';
import {FPS} from '../src/timing.ts';
import {type Asset, assetUrl, captionsFor, type DraftScene, framesFor} from './model.ts';

export function useAsset(asset?: Asset) {
  const source = asset?.source;
  const [object, setObject] = useState<{source: Blob; url: string}>();
  useEffect(() => {
    if (!(source instanceof Blob)) return;
    const url = URL.createObjectURL(source);
    setObject({source, url});
    return () => URL.revokeObjectURL(url);
  }, [source]);
  if (typeof source === 'string') return assetUrl(source);
  return object?.source === source ? object?.url : undefined;
}

export function Thumbnail({scene}: {scene: DraftScene}) {
  const src = useAsset(scene.media);
  return (
    <div className="thumbnail">
      {src && scene.media?.kind === 'image' && <img src={src} alt="" />}
      {src && scene.media?.kind === 'video' && (
        <video src={src} muted playsInline preload="metadata" aria-hidden />
      )}
      {!src && <Film size={17} />}
    </div>
  );
}

export function Preview({
  scenes,
  selectedIndex,
  music,
  musicVolume,
}: {
  scenes: DraftScene[];
  selectedIndex: number;
  music?: Asset;
  musicVolume?: number;
}) {
  const [scope, setScope] = useState<'full' | 'scene'>('full');
  const [captions, setCaptions] = useState(true);
  const player = useRef<PlayerRef>(null);
  const [urls, setUrls] = useState<Map<Blob, string>>(new Map());
  const objectUrls = useRef<Map<Blob, string>>(new Map());
  useEffect(
    () => () => {
      for (const url of objectUrls.current.values()) URL.revokeObjectURL(url);
      objectUrls.current.clear();
    },
    [],
  );
  useEffect(() => {
    const sources = new Set(
      [...scenes.flatMap((scene) => [scene.media?.source, scene.voice?.source]), music?.source].filter(
        (source): source is Blob => source instanceof Blob,
      ),
    );
    const previous = objectUrls.current;
    if (previous.size === sources.size && [...sources].every((source) => previous.has(source))) return;
    const next = new Map<Blob, string>();
    for (const source of sources) next.set(source, previous.get(source) ?? URL.createObjectURL(source));
    for (const [source, url] of previous) if (!next.has(source)) URL.revokeObjectURL(url);
    objectUrls.current = next;
    setUrls(next);
  }, [scenes, music]);
  const urlFor = (asset?: Asset) =>
    typeof asset?.source === 'string'
      ? assetUrl(asset.source)
      : asset?.source
        ? urls.get(asset.source)
        : undefined;
  const start =
    scope === 'scene' ? 0 : scenes.slice(0, selectedIndex).reduce((sum, item) => sum + framesFor(item), 0);
  const visible = scope === 'scene' ? [scenes[selectedIndex]] : scenes;
  const inputProps: PlaybackProps = {
    preview: true,
    firstIndex: scope === 'scene' ? selectedIndex : 0,
    showCaptions: captions,
    music: urlFor(music),
    musicVolume,
    scenes: visible.map((scene) => ({
      narration: scene.narration,
      frames: framesFor(scene),
      captions: captionsFor(scene),
      audio: scene.voiceOutdated ? undefined : urlFor(scene.voice),
      image: scene.media?.kind === 'image' ? urlFor(scene.media) : undefined,
      video: scene.media?.kind === 'video' ? urlFor(scene.media) : undefined,
    })),
  };
  const playerKey = JSON.stringify([
    scope,
    inputProps.music,
    inputProps.scenes.map(({audio, image, video}) => [audio, image, video]),
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new Player must seek to the selected scene after its assets change.
  useEffect(() => {
    player.current?.pause();
    player.current?.seekTo(start);
  }, [start, playerKey]);
  return (
    <div className="monitor">
      <div className="monitor-head">
        <div>
          <span className="monitor-dot" /> Preview
        </div>
        <SegmentedControl
          size="xs"
          aria-label="Preview scope"
          data={[
            {label: 'Full Short', value: 'full'},
            {label: 'Scene', value: 'scene'},
          ]}
          value={scope}
          onChange={(value) => setScope(value === 'scene' ? 'scene' : 'full')}
        />
        <ActionIcon
          variant="subtle"
          aria-label="Toggle preview captions"
          aria-pressed={captions}
          onClick={() => setCaptions(!captions)}
        >
          <Captions size={18} />
        </ActionIcon>
      </div>
      <div className="monitor-stage">
        <Player
          key={playerKey}
          ref={player}
          component={Short}
          inputProps={inputProps}
          compositionWidth={shortWidth}
          compositionHeight={shortHeight}
          durationInFrames={Math.max(
            1,
            inputProps.scenes.reduce((sum, scene) => sum + scene.frames, 0),
          )}
          fps={FPS}
          controls
          style={{height: '100%', maxWidth: '100%', aspectRatio: '9 / 16'}}
          errorFallback={({error}) => <p role="alert">Preview playback failed. {error.message}</p>}
        />
      </div>
    </div>
  );
}
