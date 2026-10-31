import {
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import Switch from "../../components/Switch";
import type { Item } from "./types";

const BINS = 1000;
const HEIGHT = 160;
const GRAB = 0.015; // how close to a trim handle counts as grabbing it, as a share of the width
const MIN_KEEP = 0.3;
const MIN_SPEED = 0.5;
const MAX_SPEED = 3;
const FIT_TIMES = [15, 30, 60];
const PITCH_WAIT = 350; // ms after the slider stops before hearing the result
// Voice styles (their sound is in backend/app/tools/voiceover/api.py), and the pitch each starts at.
const STYLES = [
  { id: "", label: "Natural", pitch: 0 },
  { id: "deep", label: "Deep", pitch: -3 },
  { id: "warm", label: "Warm", pitch: -1 },
  { id: "bright", label: "Bright", pitch: 1 },
  { id: "child", label: "Child", pitch: 5 },
  { id: "chipmunk", label: "Chipmunk", pitch: 9 },
  { id: "monster", label: "Monster", pitch: -8 },
  { id: "radio", label: "Radio", pitch: 0 },
  { id: "phone", label: "Phone call", pitch: 0 },
  { id: "robot", label: "Robot", pitch: 0 },
  { id: "echo", label: "Echo", pitch: 0 },
  { id: "hall", label: "Big hall", pitch: 0 },
  { id: "horror", label: "Horror", pitch: -4 },
];

type Effects = {
  noise: boolean;
  volume: boolean;
  pitch: number;
  style: string;
};

const clock = (t: number) =>
  `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

type Props = {
  item: Item;
  onClose: () => void;
  onSaved: (item: Item) => void;
};

/** Trim a voiceover on a waveform timeline, change its speed, or fit it to a length. */
export default function VoiceEditor({ item, onClose, onSaved }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [noise, setNoise] = useState(true);
  const [volume, setVolume] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [style, setStyle] = useState("");
  const [changed, setChanged] = useState<(Effects & { url: string }) | null>(
    null,
  );
  const [listen, setListen] = useState<"original" | "changed">("original");
  const request = useRef(0); // only the newest preview counts
  const playWhenReady = useRef(false);
  const pitchTimer = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const kept = end - start;
  const src = listen === "changed" && changed ? changed.url : item.url;

  useEffect(() => () => URL.revokeObjectURL(changed?.url ?? ""), [changed]);

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const data = await (await fetch(src)).arrayBuffer();
        const context = new AudioContext();
        const sound = await context.decodeAudioData(data);
        context.close();
        const samples = sound.getChannelData(0);
        const step = Math.max(Math.floor(samples.length / BINS), 1);
        const out: number[] = [];
        for (let i = 0; i < samples.length; i += step) {
          let peak = 0;
          for (let j = i; j < i + step && j < samples.length; j++)
            peak = Math.max(peak, Math.abs(samples[j]));
          out.push(peak);
        }
        const loudest = Math.max(...out, 0.01);
        if (gone) return;
        setPeaks(out.map((p) => p / loudest));
        setDuration(sound.duration);
        setEnd((e) => e || sound.duration); // keeps your trim when switching to the changed audio
      } catch {
        if (!gone) setError("Couldn't open this voiceover. Please try again.");
      }
    })();
    return () => {
      gone = true;
    };
  }, [src]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !peaks || !duration) return;
    const { width } = ctx.canvas;
    const x = (t: number) => (t / duration) * width;
    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.fillStyle = "rgba(255,255,255,.04)";
    ctx.fillRect(0, 0, width, HEIGHT);
    peaks.forEach((p, i) => {
      const at = (i / peaks.length) * duration;
      ctx.fillStyle = at >= start && at <= end ? "#60A5FA" : "#4B5563";
      const h = Math.max(p * (HEIGHT - 16), 1);
      ctx.fillRect(
        (i / peaks.length) * width,
        (HEIGHT - h) / 2,
        Math.max(width / peaks.length - 0.5, 1),
        h,
      );
    });
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, x(start), HEIGHT);
    ctx.fillRect(x(end), 0, width - x(end), HEIGHT);
    ctx.fillStyle = "#FBBF24";
    for (const t of [start, end]) {
      ctx.fillRect(x(t) - 2, 0, 4, HEIGHT);
      ctx.fillRect(x(t) - 7, HEIGHT / 2 - 16, 14, 32);
    }
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x(time) - 1, 0, 2, HEIGHT);
  }, [peaks, duration, start, end, time]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, peaks]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current!;
      if (a.currentTime >= end) {
        a.pause();
        a.currentTime = end;
        setPlaying(false);
      }
      setTime(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing, end]);

  const seek = useCallback((t: number) => {
    if (audio.current) audio.current.currentTime = t;
    setTime(t);
  }, []);

  function toggle() {
    const a = audio.current!;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    if (a.currentTime < start || a.currentTime >= end - 0.05) seek(start);
    a.playbackRate = speed;
    a.play().catch(() => setPlaying(false));
    setPlaying(true);
  }

  function moveStart(t: number) {
    setNote("");
    setStart(Math.min(Math.max(t, 0), end - MIN_KEEP));
  }

  function moveEnd(t: number) {
    setNote("");
    setEnd(Math.max(Math.min(t, duration), start + MIN_KEEP));
  }

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    const target = e.currentTarget;
    const at = (ev: { clientX: number }) => {
      const r = target.getBoundingClientRect();
      return Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1);
    };
    const near = (t: number) => Math.abs(at(e) - t / duration) < GRAB;
    const grabbed = near(start) ? "start" : near(end) ? "end" : null;
    target.setPointerCapture(e.pointerId);
    const move = (ev: { clientX: number }) => {
      const t = at(ev) * duration;
      if (grabbed === "start") moveStart(t);
      else if (grabbed === "end") moveEnd(t);
      else seek(t);
    };
    move(e);
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  async function preview(effects: Effects, play: boolean) {
    const mine = ++request.current;
    setCleaning(true);
    setError("");
    try {
      const res = await fetch(`/api/voiceover/items/${item.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(effects),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).detail ??
            `Request failed (${res.status})`,
        );
      const blob = await res.blob();
      if (mine !== request.current) return;
      audio.current?.pause();
      setPlaying(false);
      playWhenReady.current = play;
      setChanged({ ...effects, url: URL.createObjectURL(blob) });
      setListen("changed");
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Can't reach ShortsForge. Is the start window still open?"
          : (e as Error).message,
      );
    } finally {
      if (mine === request.current) setCleaning(false);
    }
  }

  /** Change the pitch or style, keeping any clean-up already applied, and play the result. */
  function restyle(nextPitch: number, nextStyle: string) {
    const effects = {
      noise: !!changed?.noise,
      volume: !!changed?.volume,
      pitch: nextPitch,
      style: nextStyle,
    };
    if (effects.noise || effects.volume || nextPitch || nextStyle)
      preview(effects, true);
    else {
      request.current++;
      setCleaning(false);
      setChanged(null);
      hear("original");
    }
  }

  function chooseStyle(id: string) {
    const next = STYLES.find((s) => s.id === id)!;
    clearTimeout(pitchTimer.current);
    setStyle(id);
    setPitch(next.pitch);
    restyle(next.pitch, id);
  }

  function choosePitch(next: number) {
    setPitch(next);
    clearTimeout(pitchTimer.current);
    pitchTimer.current = window.setTimeout(
      () => restyle(next, style),
      PITCH_WAIT,
    );
  }

  function hear(which: "original" | "changed") {
    audio.current?.pause();
    setPlaying(false);
    setListen(which);
  }

  /** The speed that makes the kept part last `seconds`, within what still sounds like speech. */
  function fit(seconds: number) {
    setTarget(String(seconds));
    if (!(seconds > 0)) return;
    const wanted = kept / seconds;
    const next = Math.min(Math.max(wanted, MIN_SPEED), MAX_SPEED);
    setSpeed(next);
    setNote(
      next === wanted
        ? `Speed set to ${next.toFixed(2)}× to last ${seconds}s.`
        : `That needs ${wanted.toFixed(2)}×. The limit is ${next}×, so it will last ${(kept / next).toFixed(1)}s. Trim it to get closer.`,
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      audio.current?.pause();
      setPlaying(false);
      onSaved(
        await api<Item>(`/api/voiceover/items/${item.id}/edit`, {
          method: "POST",
          json: {
            start,
            end,
            speed,
            ...(listen === "changed" && changed
              ? {
                  noise: changed.noise,
                  volume: changed.volume,
                  pitch: changed.pitch,
                  style: changed.style,
                }
              : {}),
          },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const number = (
    label: string,
    value: number,
    onChange: (v: number) => void,
  ) => (
    <label className="text-xs text-muted">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        min={0}
        max={duration}
        step={0.1}
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input w-24"
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <audio
        ref={audio}
        src={src}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          a.playbackRate = speed;
          a.currentTime = playWhenReady.current ? start : time;
          if (playWhenReady.current) {
            playWhenReady.current = false;
            setTime(start);
            a.play().catch(() => setPlaying(false));
            setPlaying(true);
          }
        }}
        className="hidden"
      />
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onClose}
          className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-white"
          title="Back to Voice Generator"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-sky uppercase">
            Edit voiceover
          </p>
          <h1 className="truncate text-xl font-black tracking-tight">
            {item.name || item.text}
          </h1>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="card p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            disabled={!peaks}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110 disabled:opacity-40"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="size-4 fill-white" />
            ) : (
              <Play className="ml-0.5 size-4 fill-white" />
            )}
          </button>
          <span className="font-mono text-sm text-muted tabular-nums">
            {clock(time)} / {clock(duration)}
          </span>
          <span className="ml-auto text-sm text-muted">
            New length{" "}
            <b className="font-mono text-white tabular-nums">
              {clock(kept / speed)}
            </b>
          </span>
        </div>
        <div className="relative mt-4">
          {!peaks && !error && (
            <Loader2 className="absolute top-1/2 left-1/2 size-5 -translate-1/2 animate-spin text-sky" />
          )}
          <canvas
            ref={canvas}
            width={1000}
            height={HEIGHT}
            onPointerDown={down}
            aria-label="Timeline"
            className="h-40 w-full cursor-pointer touch-none rounded-xl bg-ink"
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Drag the yellow handles to trim. Click the waveform to move the
          playhead. Only the bright part is kept.
        </p>
        {changed && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Listen to:</span>
            {(["original", "changed"] as const).map((which) => (
              <button
                key={which}
                onClick={() => hear(which)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ring-1 ${listen === which ? "bg-brand/20 text-sky ring-brand/50" : "bg-white/5 text-muted ring-line hover:text-white"}`}
              >
                {which}
              </button>
            ))}
            <span className="text-xs text-muted">
              The one you pick is what gets saved.
            </span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {number("Start (seconds)", start, moveStart)}
          <button onClick={() => moveStart(time)} className="btn-ghost">
            Start here
          </button>
          {number("End (seconds)", end, moveEnd)}
          <button onClick={() => moveEnd(time)} className="btn-ghost">
            End here
          </button>
        </div>
      </section>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section className="card p-4 sm:p-6">
          <div className="flex items-center">
            <span className="label mb-0">Speed</span>
            <span className="ml-auto font-mono text-xs text-muted tabular-nums">
              {speed.toFixed(2)}×
            </span>
            {speed !== 1 && (
              <button
                onClick={() => {
                  setSpeed(1);
                  setNote("");
                }}
                className="ml-2 rounded p-0.5 text-muted hover:text-white"
                title="Reset"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
          </div>
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.01}
            value={speed}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
              setNote("");
            }}
            className="mt-3 w-full accent-brand"
            aria-label="Speed"
          />
          <p className="mt-2 text-xs text-muted">
            The pitch stays the same at any speed.
          </p>
        </section>

        <section className="card p-4 sm:p-6">
          <p className="label">Auto: fit to a length</p>
          <div className="flex flex-wrap items-center gap-2">
            {FIT_TIMES.map((s) => (
              <button
                key={s}
                onClick={() => fit(s)}
                className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-muted ring-1 ring-line hover:text-white"
              >
                {s}s
              </button>
            ))}
            <input
              type="number"
              min={1}
              step={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Seconds"
              className="input w-24"
              aria-label="Length you need, in seconds"
            />
            <button
              onClick={() => fit(Number(target))}
              disabled={!(Number(target) > 0) || !peaks}
              className="btn-ghost"
            >
              <Wand2 className="size-4" /> Auto set speed
            </button>
          </div>
          {note && <p className="mt-2 text-xs text-sky">{note}</p>}
        </section>
      </div>

      <section className="card mt-6 p-4 sm:p-6">
        <p className="label">Voice style</p>
        <div className="flex flex-wrap gap-1.5">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => chooseStyle(s.id)}
              disabled={!peaks}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${style === s.id ? "bg-brand/20 text-sky ring-brand/50" : "bg-white/5 text-muted ring-line hover:text-white"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center">
          <span className="label mb-0">Pitch</span>
          {cleaning && (
            <Loader2 className="ml-2 size-3.5 animate-spin text-sky" />
          )}
          <span className="ml-auto font-mono text-xs text-muted tabular-nums">
            {pitch > 0 ? "+" : ""}
            {pitch} semitones
          </span>
          {pitch !== 0 && (
            <button
              onClick={() => choosePitch(0)}
              className="ml-2 rounded p-0.5 text-muted hover:text-white"
              title="Reset"
            >
              <RotateCcw className="size-3" />
            </button>
          )}
        </div>
        <input
          type="range"
          min={-12}
          max={12}
          step={1}
          value={pitch}
          onChange={(e) => choosePitch(Number(e.target.value))}
          disabled={!peaks}
          className="mt-3 w-full accent-brand"
          aria-label="Pitch"
        />
        <p className="mt-2 text-xs text-muted">
          Pick a style or move the slider and it plays straight away. The length
          stays the same. Small changes sound most natural; big ones sound like
          a cartoon.
        </p>
      </section>

      <section className="card mt-6 p-4 sm:p-6">
        <p className="label">Clean up audio</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <span className="inline-flex items-center gap-2">
            <Switch
              on={noise}
              onChange={setNoise}
              label="Reduce background noise"
            />
            Reduce background noise
          </span>
          <span className="inline-flex items-center gap-2">
            <Switch on={volume} onChange={setVolume} label="Even out volume" />
            Even out volume
          </span>
          <button
            onClick={() => preview({ noise, volume, pitch, style }, false)}
            disabled={!peaks || cleaning || (!noise && !volume)}
            className="btn-ghost sm:ml-auto"
          >
            {cleaning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {cleaning ? "Cleaning…" : "Clean up audio"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Best on steady sounds like fans, hiss and hum. It can&apos;t remove
          other voices or sudden noises.
        </p>
      </section>

      <button
        onClick={save}
        disabled={!peaks || saving}
        className="btn-primary mt-6 px-6 py-3 text-base"
      >
        {saving ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Save className="size-5" />
        )}
        Save as new MP3
      </button>
      <p className="mt-2 text-xs text-muted">
        The original stays in your list.
      </p>
    </div>
  );
}
