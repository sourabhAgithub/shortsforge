import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Framed, lines, Outlined } from "../aivideo/PreviewFrame";
import { H, W } from "../aivideo/layout";
import { type TextItem, trimWindow, type VgProject } from "./types";

/** Lines + size like _lines() in render.py: typed line breaks kept, long lines split in two. */
function textLines(
  text: string,
  maxW: number,
  size: number,
): [string[], number] {
  const out: string[] = [];
  let best = size;
  for (const para of text.split("\n")) {
    const clean = para.split(/\s+/).filter(Boolean).join(" ");
    if (!clean) continue;
    const [ls, s] = lines(clean, maxW, size, size, size);
    out.push(...ls);
    best = Math.min(best, s);
  }
  return [out, best];
}

function TextOverlay({ item }: { item: TextItem }) {
  const [ls, size] = textLines(item.text, item.box ? 940 : 1000, item.size);
  if (!ls.length) return null;
  const ratio = item.box ? 0.07 : 0.11;
  return (
    <div
      className="absolute flex flex-col items-center"
      style={{
        left: item.x * W,
        top: item.y * H,
        transform: "translate(-50%, -50%)",
        ...(item.box && {
          background: item.box_color,
          borderRadius: 34,
          padding: "26px 44px",
        }),
      }}
    >
      {ls.map((l, k) => (
        <Outlined
          key={k}
          text={l}
          size={size}
          color={item.color}
          ratio={ratio}
        />
      ))}
    </div>
  );
}

type Props = {
  project: VgProject;
  t: number; // seconds in the finished video
  onTime: (t: number) => void;
  width?: number;
};

/** Live preview: the trimmed video with its sound settings, the external audio, texts and captions. */
export default function VideoPreview({
  project,
  t,
  onTime,
  width = 270,
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const s = project.settings;
  const [start, end] = trimWindow(project);
  const dur = Math.max(end - start, 0);

  // Follow the editor's time when it changes while paused (seeking, "jump to" buttons).
  useEffect(() => {
    const v = video.current;
    if (v && !playing && Math.abs(v.currentTime - (start + t)) > 0.05)
      v.currentTime = start + t;
  }, [t, start, playing]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = !s.video_sound || !project.video?.has_audio;
    v.volume = Math.min(1, s.video_volume);
    if (audio.current) audio.current.volume = Math.min(1, s.audio_volume);
  }, [s.video_sound, s.video_volume, s.audio_volume, project.video?.has_audio]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (!v) return;
      const now = v.currentTime - start;
      if (now >= dur - 0.03 || v.ended) {
        v.pause();
        audio.current?.pause();
        setPlaying(false);
        onTime(dur);
        return;
      }
      onTime(Math.max(now, 0));
      const a = audio.current;
      if (a) {
        const want = now - s.audio_start;
        if (want >= 0 && want < (a.duration || 0)) {
          if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
          if (a.paused) a.play().catch(() => {});
        } else if (!a.paused) a.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, dur, s.audio_start, onTime]);

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.pause();
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    if (t >= dur - 0.05) {
      v.currentTime = start;
      onTime(0);
    }
    v.play().catch(() => {});
    // Start the audio inside the tap so phones allow it; the playback loop then keeps it in step.
    const a = audio.current;
    if (a) {
      const want = v.currentTime - start - s.audio_start;
      if (want >= 0 && want < (a.duration || 0)) a.currentTime = want;
      a.play()
        .then(() => {
          if (want < 0 || want >= (a.duration || 0)) a.pause();
        })
        .catch(() => {});
    }
    setPlaying(true);
  }

  if (!project.video)
    return (
      <p className="text-sm text-muted">
        Add a video (step 2) to preview it here.
      </p>
    );

  const cue = s.captions
    ? project.captions.find((c) => t >= c.start && t < c.end)
    : undefined;
  const [capLines, capSize] = cue
    ? textLines(cue.text, 1000, s.caption_size)
    : [[], 0];

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-[2.4rem] bg-gradient-to-b from-white/15 to-white/5 p-2.5 shadow-2xl shadow-black/60">
        <div
          className="relative overflow-hidden rounded-[2rem] bg-black"
          style={{ width, height: (width * H) / W }}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: W, height: H, transform: `scale(${width / W})` }}
          >
            <Framed
              fit={s.fit}
              blurSrc={
                project.video.thumb ? (
                  <img
                    src={project.video.thumb}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : null
              }
            >
              {(cls) => (
                <video
                  ref={video}
                  src={project.video!.url}
                  playsInline
                  preload="auto"
                  className={cls}
                />
              )}
            </Framed>
            {project.texts
              .filter((x) => t >= x.start && t < x.end)
              .map((x) => (
                <TextOverlay key={x.id} item={x} />
              ))}
            {cue && (
              <div
                className="absolute left-0 flex w-full flex-col items-center"
                style={{ top: s.caption_y * H, transform: "translateY(-50%)" }}
              >
                {capLines.map((l, k) => (
                  <Outlined
                    key={k}
                    text={l}
                    size={capSize}
                    color={s.caption_color}
                    ratio={0.11}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {project.audio && (
        <audio ref={audio} src={project.audio.url} preload="auto" />
      )}

      <div
        className="mt-4 flex w-full items-center gap-3"
        style={{ maxWidth: width + 20 }}
      >
        <button
          onClick={toggle}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110"
          title={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause className="size-4 fill-white" />
          ) : (
            <Play className="ml-0.5 size-4 fill-white" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={dur}
          step={0.01}
          value={Math.min(t, dur)}
          onChange={(e) => onTime(Number(e.target.value))}
          disabled={playing}
          className="min-w-0 flex-1 accent-brand"
          aria-label="Playhead"
        />
        <span className="w-20 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
          {t.toFixed(1)} / {dur.toFixed(1)}s
        </span>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted/70">
        Preview (rendered video may differ slightly)
      </p>
    </div>
  );
}
