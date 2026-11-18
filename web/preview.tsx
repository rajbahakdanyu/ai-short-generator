import {ActionIcon, Slider} from '@mantine/core';
import {Captions, Film, Maximize, Pause, Play, SkipBack} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
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

export function Preview({scene, number}: {scene: DraftScene; number: number}) {
  const media = useAsset(scene.media);
  const voice = useAsset(scene.voice);
  const audio = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [position, setPosition] = useState(0);
  const current = useRef(0);
  const duration = secondsFor(scene);

  function seek(seconds: number) {
    current.current = seconds;
    setPosition(seconds);
    if (audio.current?.readyState) audio.current.currentTime = seconds;
    if (video.current?.duration) video.current.currentTime = seconds % video.current.duration;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the media, voice, or duration resets playback.
  useEffect(() => {
    current.current = 0;
    setPosition(0);
    setPlaying(false);
    if (audio.current?.readyState) audio.current.currentTime = 0;
    if (video.current?.readyState) video.current.currentTime = 0;
  }, [media, voice, duration]);

  useEffect(() => {
    const sound = voice ? audio.current : null;
    const clip = media ? video.current : null;
    if (!playing) {
      sound?.pause();
      clip?.pause();
      return;
    }
    void sound?.play().catch(() => setPlaying(false));
    void clip?.play().catch(() => {});
    let previous = performance.now();
    let request = 0;
    const tick = (now: number) => {
      const seconds = sound ? sound.currentTime : current.current + (now - previous) / 1000;
      previous = now;
      current.current = Math.min(seconds, duration);
      setPosition(current.current);
      if (seconds >= duration || sound?.ended) setPlaying(false);
      else request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      sound?.pause();
      clip?.pause();
    };
  }, [playing, duration, media, voice]);

  const progress = position / duration;
  const pushIn = number % 2 === 1;
  const scale = pushIn ? 1.05 + 0.13 * progress : 1.18 - 0.13 * progress;
  const slide = (pushIn ? -1 : 1) * (1.8 - 2.9 * progress);
  const text =
    captions && captionsFor(scene).find(({start, end}) => start <= position && position < end)?.text;
  return (
    <div className="monitor">
      <div className="monitor-head">
        <div>
          <span className="monitor-dot" /> Scene preview
        </div>
        <span className="aspect-label">9:16</span>
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
            <video ref={video} src={media} muted loop playsInline preload="metadata" />
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
          <span className="scene-chip">SCENE {String(number).padStart(2, '0')}</span>
        </div>
      </div>
      {voice && (
        // biome-ignore lint/a11y/useMediaCaption: The preview displays the same captions over the visual during narration.
        <audio ref={audio} key={voice} src={voice} preload="auto" />
      )}
      <div className="transport">
        <ActionIcon variant="subtle" color="gray" aria-label="Restart scene" onClick={() => seek(0)}>
          <SkipBack size={17} />
        </ActionIcon>
        <ActionIcon
          className="play-button"
          size={36}
          aria-label={playing ? 'Pause scene' : 'Play scene'}
          onClick={() => {
            if (!playing && (position >= duration || audio.current?.ended)) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </ActionIcon>
        <span className="timecode">
          {formatTime(position)} <span>/ {formatTime(duration)}</span>
        </span>
        <Slider
          className="scrubber"
          min={0}
          max={duration}
          step={0.01}
          value={position}
          onChange={seek}
          label={null}
          aria-label="Scene playback position"
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
