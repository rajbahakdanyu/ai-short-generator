import {ActionIcon, SegmentedControl, Slider} from '@mantine/core';
import {Captions, Film, Maximize, Pause, Play, SkipBack} from 'lucide-react';
import {type RefObject, useEffect, useMemo, useRef, useState} from 'react';
import {type Asset, assetUrl, captionsFor, type DraftScene, formatTime, secondsFor} from './model.ts';

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

function syncTime(element: HTMLMediaElement, seconds: number, playing: boolean) {
  if (!element.readyState || element.seeking) return;
  const duration = element.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const desired = element.loop ? seconds % duration : Math.min(seconds, duration);
  if (Math.abs(element.currentTime - desired) > (playing ? 0.16 : 0.005)) {
    element.currentTime = desired;
  }
}

function usePlayback(
  ref: RefObject<HTMLMediaElement | null>,
  source: string | undefined,
  seconds: number,
  playing: boolean,
) {
  useEffect(() => {
    const element = source ? ref.current : null;
    if (element && playing) void element.play().catch(() => {});
    return () => element?.pause();
  }, [source, playing, ref]);

  useEffect(() => {
    const element = ref.current;
    if (element) syncTime(element, seconds, playing);
  }, [seconds, playing, ref]);
}

export function Preview({
  scenes,
  selectedIndex,
  music,
}: {
  scenes: DraftScene[];
  selectedIndex: number;
  music?: Asset;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const soundtrack = useRef<HTMLAudioElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<'full' | 'scene'>('full');
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [position, setPosition] = useState(0);
  const current = useRef(0);

  const timeline = useMemo(() => {
    let cursor = 0;
    return scenes.map((scene) => {
      const start = cursor;
      cursor += secondsFor(scene);
      return {start, end: cursor, scene};
    });
  }, [scenes]);
  const selected = timeline[selectedIndex];
  const duration = scope === 'full' ? timeline[timeline.length - 1].end : selected.end - selected.start;
  const playhead = Math.min(position, duration);
  const active = scope === 'full' ? timeline.findIndex(({end}) => end > playhead) : selectedIndex;
  const number = (active < 0 ? timeline.length - 1 : active) + 1;
  const shot = timeline[number - 1];
  const scene = shot.scene;
  const localTime = scope === 'full' ? Math.max(0, playhead - shot.start) : playhead;
  const musicTime = scope === 'full' ? playhead : selected.start + playhead;
  const selectedId = selected.scene.id;
  const start = scope === 'full' ? selected.start : 0;
  const media = useAsset(scene.media);
  const voice = useAsset(scene.voice);
  const track = useAsset(music);
  const clipSource = scene.media?.kind === 'video' ? media : undefined;

  function seek(seconds: number) {
    current.current = seconds;
    setPosition(seconds);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Replacing the selected scene at the same timeline position resets playback.
  useEffect(() => {
    setPlaying(false);
    current.current = start;
    setPosition(start);
  }, [start, scope, selectedId]);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let request = 0;
    const tick = (now: number) => {
      current.current = Math.min(current.current + (now - previous) / 1000, duration);
      previous = now;
      setPosition(current.current);
      if (current.current < duration) request = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, duration]);

  usePlayback(video, clipSource, localTime, playing);
  usePlayback(audio, voice, localTime, playing);
  usePlayback(soundtrack, track, musicTime, playing);

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (playhead >= duration) seek(0);
    void audio.current?.play().catch(() => {});
    void soundtrack.current?.play().catch(() => {});
    setPlaying(true);
  }

  const progress = localTime / (shot.end - shot.start);
  const pushIn = number % 2 === 1;
  const scale = pushIn ? 1.05 + 0.13 * progress : 1.18 - 0.13 * progress;
  const slide = (pushIn ? -1 : 1) * (1.8 - 2.9 * progress);
  const text =
    captions && captionsFor(scene).find(({start, end}) => start <= localTime && localTime < end)?.text;
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
      </div>
      <div className="monitor-stage" ref={stage}>
        <div className="phone" key={media}>
          {media && scene.media?.kind === 'image' && (
            <img
              src={media}
              alt="Scene illustration"
              style={{transform: `translateX(${slide}%) scale(${scale})`}}
            />
          )}
          {media && scene.media?.kind === 'video' && (
            <video
              ref={video}
              src={media}
              muted
              loop
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => syncTime(event.currentTarget, localTime, playing)}
            />
          )}
          {!media && (
            <div className="empty-frame">
              <Film size={28} />
              <span>Add a visual to preview</span>
            </div>
          )}
          {text && (
            <div className={number === 1 ? 'preview-caption opening-caption' : 'preview-caption'} key={text}>
              {text}
            </div>
          )}
          <span className="scene-chip">
            SCENE {String(number).padStart(2, '0')}
            {!scene.voice && scene.narration.trim() && ' · VOICE PENDING'}
          </span>
        </div>
      </div>
      {voice && (
        // biome-ignore lint/a11y/useMediaCaption: The preview displays the same captions over the visual during narration.
        <audio
          ref={audio}
          src={voice}
          preload="auto"
          onLoadedMetadata={(event) => syncTime(event.currentTarget, localTime, playing)}
        />
      )}
      {track && (
        // biome-ignore lint/a11y/useMediaCaption: The optional soundtrack plays under the separately captioned narration.
        <audio
          ref={soundtrack}
          src={track}
          preload="auto"
          loop
          onLoadedMetadata={(event) => {
            event.currentTarget.volume = 0.13;
            syncTime(event.currentTarget, musicTime, playing);
          }}
        />
      )}
      <div className="transport">
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={scope === 'full' ? 'Restart Short' : 'Restart scene'}
          onClick={() => seek(0)}
        >
          <SkipBack size={17} />
        </ActionIcon>
        <ActionIcon
          className="play-button"
          size={36}
          aria-label={playing ? 'Pause preview' : scope === 'full' ? 'Play full Short' : 'Play scene'}
          onClick={togglePlayback}
        >
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </ActionIcon>
        <span className="timecode">
          {formatTime(playhead)} <span>/ {formatTime(duration)}</span>
        </span>
        <Slider
          className="scrubber"
          min={0}
          max={duration}
          step={0.01}
          value={playhead}
          onChange={seek}
          label={null}
          aria-label={scope === 'full' ? 'Full Short playback position' : 'Scene playback position'}
          size="xs"
        />
        <ActionIcon
          variant={captions ? 'light' : 'subtle'}
          color="gray"
          aria-label="Toggle preview captions"
          aria-pressed={captions}
          onClick={() => setCaptions(!captions)}
        >
          <Captions size={18} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Full-screen preview"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void stage.current?.requestFullscreen().catch(() => {});
          }}
        >
          <Maximize size={16} />
        </ActionIcon>
      </div>
    </div>
  );
}
