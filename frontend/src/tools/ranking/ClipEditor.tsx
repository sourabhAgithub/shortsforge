import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Switch from "../../components/Switch";
import FramedClip from "./FramedClip";
import { AREA_H, slotRange, W } from "./layout";
import type { RankSettings, Slot } from "./types";

const PREVIEW_W = 150;
const r1 = (v: number) => Math.round(v * 10) / 10;

type Props = {
  slot: Slot;
  settings: RankSettings;
  onChange: (patch: Partial<Slot>) => void;
};

/** Trim on a timeline of the real clip, crop (zoom + position) and the clip's own sound. */
export default function ClipEditor({ slot, settings: s, onChange }: Props) {
  const clip = slot.clip!;
  const dur = clip.duration;
  const { start, length } = slotRange(slot, s);
  const end = start + length;
  // The part the user picked; it can be longer than what plays when "max seconds" caps it.
  const picked = Math.min(slot.end && slot.end > start ? slot.end : dur, dur);
  const auto = slot.start == null && slot.end == null;

  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(start);

  // Loop the part that plays.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.05)
        v.currentTime = start;
      setNow(v.currentTime);
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [start, end]);

  useEffect(() => {
    const v = video.current;
    if (v && !playing) {
      v.currentTime = start;
      setNow(start);
    }
  }, [start, playing]);

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
      v.muted = slot.mute;
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function drag(e: React.PointerEvent, mode: "start" | "end" | "move") {
    e.stopPropagation();
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const at = (x: number) =>
      Math.min(Math.max((x - r.left) / r.width, 0), 1) * dur;
    const grab = at(e.clientX) - start;
    const width = picked - start;
    const move = (x: number) => {
      const v = at(x);
      if (mode === "start")
        onChange({ start: r1(Math.min(v, picked - 0.5)), end: r1(picked) });
      else if (mode === "end")
        onChange({ start: r1(start), end: r1(Math.max(v, start + 0.5)) });
      else {
        const st = Math.min(Math.max(v - grab, 0), dur - width);
        onChange({ start: r1(st), end: r1(st + width) });
      }
      const vid = video.current;
      if (vid && !playing)
        vid.currentTime =
          mode === "end" ? Math.max(v - 0.05, 0) : Math.min(v, dur);
    };
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const pct = (v: number) => `${(v / dur) * 100}%`;
  const scale = PREVIEW_W / W;
  const cropped = slot.zoom > 1 || slot.pan_x !== 0.5 || slot.pan_y !== 0.5;

  return (
    <div className="space-y-4 rounded-xl bg-ink p-3 ring-1 ring-line">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* The clip as it will appear in the video (crop included). */}
        <div className="shrink-0 self-center sm:self-start">
          <div
            className="relative overflow-hidden rounded-lg ring-1 ring-line"
            style={{ width: PREVIEW_W, height: AREA_H * scale }}
          >
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{ transform: `scale(${scale})` }}
            >
              <FramedClip
                slot={slot}
                fit={s.fit_mode}
                media={(style, background) =>
                  background ? (
                    <img
                      src={clip.thumb}
                      alt=""
                      className="absolute max-w-none"
                      style={style}
                    />
                  ) : (
                    <video
                      ref={video}
                      src={clip.video}
                      preload="auto"
                      playsInline
                      className="absolute max-w-none object-fill"
                      style={style}
                    />
                  )
                }
              />
            </div>
          </div>
          <button
            onClick={toggle}
            className="btn-ghost mt-2 w-full px-3 py-1.5 text-xs"
          >
            {playing ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}{" "}
            {playing ? "Pause" : "Play this part"}
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          {/* Timeline of the whole clip */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-white">Timeline</span>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${auto ? "bg-white/5 text-muted" : "bg-sky/15 text-sky"}`}
              >
                {auto ? "Auto" : "Custom"}
              </span>
              <span className="text-muted">
                Plays {start.toFixed(1)}–{end.toFixed(1)}s ({length.toFixed(1)}s
                of {dur.toFixed(1)}s)
              </span>
              {!auto && (
                <button
                  onClick={() => onChange({ start: null, end: null })}
                  className="ml-auto inline-flex items-center gap-1 text-muted hover:text-white"
                >
                  <RotateCcw className="size-3" /> Auto
                </button>
              )}
            </div>
            <div
              ref={track}
              className="relative h-10 touch-none rounded-lg bg-white/5 ring-1 ring-line select-none"
            >
              {/* picked range; the part past "max seconds" is striped (it won't play) */}
              <div
                onPointerDown={(e) => drag(e, "move")}
                className="absolute inset-y-0 cursor-grab rounded-md border border-sky/70 bg-brand/40 active:cursor-grabbing"
                style={{
                  left: pct(start),
                  width: pct(Math.max(picked - start, 0)),
                }}
                title="Drag to move the part that plays"
              >
                {picked > end + 0.05 && (
                  <div
                    className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(45deg,transparent_0_5px,rgba(0,0,0,0.45)_5px_10px)]"
                    style={{
                      width: `${((picked - end) / (picked - start)) * 100}%`,
                    }}
                    title={`Cut off by "max seconds per clip" (${s.max_seconds}s)`}
                  />
                )}
                <span
                  onPointerDown={(e) => drag(e, "start")}
                  className="absolute inset-y-0 -left-1 w-3 cursor-ew-resize rounded-l-md bg-sky pointer-coarse:w-5"
                  title="Start"
                />
                <span
                  onPointerDown={(e) => drag(e, "end")}
                  className="absolute inset-y-0 -right-1 w-3 cursor-ew-resize rounded-r-md bg-sky pointer-coarse:w-5"
                  title="End"
                />
              </div>
              <div
                className="pointer-events-none absolute -inset-y-1 w-0.5 bg-red-400"
                style={{ left: pct(Math.min(now, dur)) }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>0s</span>
              <span>{dur.toFixed(1)}s</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>From</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={slot.start ?? ""}
                placeholder="0"
                onChange={(e) =>
                  onChange({
                    start:
                      e.target.value === ""
                        ? null
                        : Math.max(0, Number(e.target.value)),
                  })
                }
                className="input w-20 py-1.5"
              />
              <span>to</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={slot.end ?? ""}
                placeholder={dur.toFixed(1)}
                onChange={(e) =>
                  onChange({
                    end:
                      e.target.value === ""
                        ? null
                        : Math.max(0, Number(e.target.value)),
                  })
                }
                className="input w-20 py-1.5"
              />
              <span>seconds</span>
            </div>
          </div>

          {/* Crop */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="font-semibold text-white">Crop</span>
              <span className="text-muted">
                Zoom in, then choose which part shows
              </span>
              {cropped && (
                <button
                  onClick={() => onChange({ zoom: 1, pan_x: 0.5, pan_y: 0.5 })}
                  className="ml-auto inline-flex items-center gap-1 text-muted hover:text-white"
                >
                  <RotateCcw className="size-3" /> Reset
                </button>
              )}
            </div>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
              {(
                [
                  ["zoom", "Zoom", 1, 3, 0.05, `${slot.zoom.toFixed(2)}×`],
                  [
                    "pan_x",
                    "Left ↔ right",
                    0,
                    1,
                    0.01,
                    `${Math.round(slot.pan_x * 100)}%`,
                  ],
                  [
                    "pan_y",
                    "Up ↕ down",
                    0,
                    1,
                    0.01,
                    `${Math.round(slot.pan_y * 100)}%`,
                  ],
                ] as const
              ).map(([key, label, min, max, step, shown]) => (
                <label key={key} className="text-xs text-muted">
                  <span className="flex justify-between">
                    {label} <span>{shown}</span>
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={slot[key]}
                    onChange={(e) =>
                      onChange({ [key]: Number(e.target.value) })
                    }
                    className="w-full accent-brand"
                  />
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted/80">
              {s.fit_mode === "fill"
                ? "Fill (crop) framing: the position sliders pick which part of a wide clip fills the screen."
                : "Fit + blur framing: zoom in first, then the position sliders move the zoomed window."}
            </p>
          </div>

          {/* Sound */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
            <span className="flex items-center gap-2 text-sm">
              {slot.mute || !clip.has_audio ? (
                <VolumeX className="size-4 text-muted" />
              ) : (
                <Volume2 className="size-4 text-sky" />
              )}
              <span>
                Use this clip's sound
                <span className="block text-[11px] text-muted">
                  {!clip.has_audio
                    ? "This clip has no sound."
                    : s.audio_mode === "external"
                      ? "Not used: the video plays your external audio only (Sound section)."
                      : slot.mute
                        ? "Silent in the video."
                        : "Plays in the video."}
                </span>
              </span>
            </span>
            {clip.has_audio && (
              <Switch
                on={!slot.mute}
                onChange={(v) => onChange({ mute: !v })}
                label="Use this clip's sound"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
