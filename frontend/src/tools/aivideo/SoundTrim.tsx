import { Pause, Play, RotateCcw, Scissors } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { type SoundClip, soundPart, soundPlayed } from "./types";

const BARS = 120;
const SHORTEST = 0.1; // seconds that must stay
const r2 = (v: number) => Math.round(v * 100) / 100;

type Props = {
  clip: SoundClip;
  total: number; // of the video
  onChange: (id: string, patch: Partial<SoundClip>) => void;
  onListen: () => void; // about to play the sound on its own
};

/** Loudest point of each slice of a sound, 0–1. Empty if the browser can't decode the file. */
async function peaksOf(url: string): Promise<number[]> {
  const data = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(
    data,
  );
  const samples = audio.getChannelData(0);
  const size = Math.max(Math.floor(samples.length / BARS), 1);
  const peaks = Array.from({ length: BARS }, (_, i) => {
    let top = 0;
    const end = Math.min((i + 1) * size, samples.length);
    for (let k = i * size; k < end; k += 16)
      top = Math.max(top, Math.abs(samples[k]));
    return top;
  });
  const loudest = Math.max(...peaks, 0.01);
  return peaks.map((p) => p / loudest);
}

/** A seconds box that applies when you finish typing, so "12" doesn't pass through "1" on the way. */
export function TimeBox({
  value,
  onCommit,
  className = "w-24",
  label,
}: {
  value: number;
  onCommit: (seconds: number) => void;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(String(r2(value)));
  useEffect(() => setDraft(String(r2(value))), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(v)) setDraft(String(r2(value)));
    else onCommit(v);
  };
  return (
    <input
      type="number"
      step={0.1}
      min={0}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`input py-1.5 text-xs ${className}`}
    />
  );
}

/** Pick the part of a sound to keep, on its waveform. */
export default function SoundTrim({ clip, total, onChange, onListen }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [at, setAt] = useState<number | null>(null); // playback position, while listening
  const from = clip.trim_start;
  const to = clip.duration - clip.trim_end;
  const pct = (v: number) => `${(v / clip.duration) * 100}%`;

  useEffect(() => {
    let live = true;
    setPeaks([]);
    peaksOf(clip.url)
      .then((p) => live && setPeaks(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clip.url]);

  useEffect(() => {
    if (at === null) return;
    let raf = 0;
    const tick = () => {
      const el = player.current;
      if (!el || el.paused || el.currentTime >= to) {
        el?.pause();
        setAt(null);
        return;
      }
      setAt(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [at === null, to]);

  function setRange(a: number, b: number) {
    const looped = clip.length > soundPlayed(clip) + 0.01;
    const part = (b - a) / clip.speed;
    onChange(clip.id, {
      trim_start: r2(a),
      trim_end: r2(clip.duration - b),
      // A clip that plays its part once keeps doing so; a looped one keeps its length.
      ...(looped ? {} : { length: r2(Math.min(part, total - clip.start)) }),
    });
  }

  const setFrom = (v: number) =>
    setRange(Math.min(Math.max(v, 0), to - SHORTEST), to);
  const setTo = (v: number) =>
    setRange(from, Math.max(Math.min(v, clip.duration), from + SHORTEST));

  function dragEdge(e: ReactPointerEvent, set: (time: number) => void) {
    e.preventDefault();
    e.stopPropagation();
    const r = bar.current!.getBoundingClientRect();
    const move = (x: number) => set(((x - r.left) / r.width) * clip.duration);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function listen() {
    const el = player.current;
    if (!el) return;
    if (at !== null) {
      el.pause();
      return setAt(null);
    }
    onListen();
    el.currentTime = from;
    el.volume = clip.volume;
    el.playbackRate = clip.speed;
    el.play()
      .then(() => setAt(from))
      .catch(() => {});
  }

  return (
    <div className="rounded-lg bg-white/5 p-3">
      <audio ref={player} src={clip.url} preload="auto" />
      <div className="mb-2 flex items-center gap-2">
        <Scissors className="size-3.5 text-muted" />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">Trim</p>
        <button
          onClick={() => setRange(0, clip.duration)}
          className="btn-ghost px-3 py-1.5 text-xs"
          title="Keep the whole sound"
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
        <button
          onClick={listen}
          className="btn-ghost px-3 py-1.5 text-xs"
          title="Listen to the part you're keeping"
        >
          {at !== null ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}{" "}
          Play part
        </button>
      </div>
      <div
        ref={bar}
        className="relative h-14 touch-none overflow-hidden rounded bg-ink ring-1 ring-line"
      >
        <div className="absolute inset-0 flex items-center gap-px px-px">
          {peaks.map((p, i) => (
            <span
              key={i}
              className="min-w-0 flex-1 rounded-sm bg-emerald-400/60"
              style={{ height: `${Math.max(p * 100, 3)}%` }}
            />
          ))}
        </div>
        <div
          className="absolute inset-y-0 left-0 bg-black/65"
          style={{ width: pct(from) }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/65"
          style={{ left: pct(to) }}
        />
        <button
          onPointerDown={(e) => dragEdge(e, setFrom)}
          className="absolute inset-y-0 w-2 cursor-ew-resize bg-emerald-300 pointer-coarse:w-4"
          style={{ left: pct(from) }}
          aria-label="Start of the part to keep"
        />
        <button
          onPointerDown={(e) => dragEdge(e, setTo)}
          className="absolute inset-y-0 w-2 -translate-x-full cursor-ew-resize bg-emerald-300 pointer-coarse:w-4"
          style={{ left: pct(to) }}
          aria-label="End of the part to keep"
        />
        {at !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-400"
            style={{ left: pct(at) }}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <label className="flex items-center gap-1.5">
          From (s)
          <TimeBox
            value={from}
            onCommit={setFrom}
            label="Keep from (seconds)"
          />
        </label>
        <label className="flex items-center gap-1.5">
          To (s)
          <TimeBox value={to} onCommit={setTo} label="Keep to (seconds)" />
        </label>
        <span className="ml-auto">
          Keeping {soundPart(clip).toFixed(1)}s of {clip.duration.toFixed(1)}s
          {clip.speed !== 1 && ` · plays in ${soundPlayed(clip).toFixed(1)}s`}
        </span>
      </div>
    </div>
  );
}
