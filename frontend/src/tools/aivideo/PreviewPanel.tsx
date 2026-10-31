import {
  AudioLines,
  EyeOff,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { formatSeconds, type Job } from "../../api";
import Switch from "../../components/Switch";
import { normWord } from "../ranking/layout";
import PreviewFrame from "./PreviewFrame";
import SoundEditor from "./SoundEditor";
import SoundPanel from "./SoundPanel";
import TitleColors from "./TitleColors";
import {
  type AiProject,
  type Cue,
  labelWindow,
  type Scene,
  sceneCues,
  type SoundClip,
  soundPlayed,
  soundRows,
} from "./types";

const MIN_SCENE = 0.3;
const MIN_CUE = 0.2;
const MIN_SOUND = 0.1;
const CLICK_SLOP = 4; // pixels; less movement than this is a click, not a drag
const SOUND_ROW = 30;
const r2 = (v: number) => Math.round(v * 100) / 100;

type Props = {
  project: AiProject;
  timings: [number, number][];
  onScenes: (fn: (scenes: Scene[]) => Scene[]) => void;
  onProject: (fn: (p: AiProject) => AiProject) => void;
  onSync: () => void;
  syncJob: Job | null;
  syncing: boolean;
  syncError: string;
  syncNote: string; // warning after a sync that worked
};

/** Pins every scene to its current start/end so one boundary can move without the rest re-flowing. */
function withTimes(scenes: Scene[], timings: [number, number][]): Scene[] {
  return scenes.map((s, i) => ({
    ...s,
    start: r2(timings[i][0]),
    end: r2(timings[i][1]),
  }));
}

export default function PreviewPanel({
  project,
  timings,
  onScenes,
  onProject,
  onSync,
  syncJob,
  syncing,
  syncError,
  syncNote,
}: Props) {
  const voice = useRef<HTMLAudioElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const players = useRef(new Map<string, HTMLAudioElement>());
  const sounds = useRef(project.sounds);
  sounds.current = project.sounds;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const total = project.voiceover?.duration ?? 0;
  const s = project.settings;

  useEffect(() => {
    if (!playing) {
      music.current?.pause();
      players.current.forEach((el) => {
        el.pause();
        el.muted = true;
      });
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick); // first, so one bad sound can't stop the picture
      if (voice.current) {
        setT(voice.current.currentTime);
        driveSounds(voice.current.currentTime);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /** Each player runs only while the playhead is inside its clip. */
  function driveSounds(at: number) {
    for (const c of sounds.current) {
      const el = players.current.get(c.id);
      if (!el) continue;
      if (at < c.start || at >= c.start + c.length) {
        el.muted = true;
        if (!el.paused) el.pause();
        continue;
      }
      const want = c.trim_start + ((at - c.start) % soundPlayed(c)) * c.speed;
      el.playbackRate = c.speed;
      if (el.paused || el.muted || Math.abs(el.currentTime - want) > 0.3)
        el.currentTime = want;
      el.volume = c.volume;
      el.muted = false;
      if (el.paused) el.play().catch(() => {});
    }
  }

  function syncMusic(at: number) {
    const m = music.current;
    if (!m || !m.duration) return;
    m.currentTime = at % m.duration;
    m.volume = Math.min(1, s.music_volume);
  }

  function toggle() {
    const v = voice.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (v.ended || v.currentTime >= total - 0.05) v.currentTime = 0;
      syncMusic(v.currentTime);
      v.play();
      music.current?.play().catch(() => {});
      // Started here, on the tap, so browsers allow them to be heard later.
      players.current.forEach((el) => el.play().catch(() => {}));
      setPlaying(true);
    }
  }

  function seek(at: number) {
    const x = Math.min(Math.max(at, 0), total);
    if (voice.current) voice.current.currentTime = x;
    syncMusic(x);
    setT(x);
  }

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * total;
  };

  /** Pointer drag helper: calls `move` with the time under the pointer until release. */
  function drag(e: ReactPointerEvent, move: (time: number) => void) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => move(timeAt(ev.clientX));
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  function moveBoundary(i: number, time: number) {
    const lo = timings[i - 1][0] + MIN_SCENE;
    const hi = timings[i][1] - MIN_SCENE;
    const x = r2(Math.min(Math.max(time, lo), hi));
    onScenes((scenes) => {
      const out = withTimes(scenes, timings);
      out[i] = { ...out[i], start: x };
      out[i - 1] = { ...out[i - 1], end: x };
      return out;
    });
  }

  const cuesOf = (i: number): Cue[] =>
    sceneCues(project.scenes[i], timings[i][0], timings[i][1]);
  const setCues = (i: number, cues: Cue[] | null) =>
    onScenes((scenes) =>
      scenes.map((x, k) => (k === i ? { ...x, captions: cues } : x)),
    );

  function editCue(i: number, j: number, patch: Partial<Cue>) {
    const [a, b] = timings[i];
    const cues = cuesOf(i).map((c, k) => (k === j ? { ...c, ...patch } : c));
    const c = cues[j];
    c.start = r2(Math.min(Math.max(c.start, a), b - MIN_CUE));
    c.end = r2(Math.min(Math.max(c.end, c.start + MIN_CUE), b));
    setCues(i, cues);
  }

  function dragCue(
    e: ReactPointerEvent,
    i: number,
    j: number,
    mode: "move" | "start" | "end",
  ) {
    const c0 = cuesOf(i)[j];
    const grab = timeAt(e.clientX);
    drag(e, (time) => {
      if (mode === "start")
        editCue(i, j, { start: Math.min(time, c0.end - MIN_CUE) });
      else if (mode === "end")
        editCue(i, j, { end: Math.max(time, c0.start + MIN_CUE) });
      else {
        const len = c0.end - c0.start;
        const [a, b] = timings[i];
        const start = Math.min(Math.max(c0.start + time - grab, a), b - len);
        editCue(i, j, { start, end: start + len });
      }
    });
  }

  const patchScene = (i: number, patch: Partial<Scene>) =>
    onScenes((scenes) =>
      scenes.map((x, k) => (k === i ? { ...x, ...patch } : x)),
    );

  /** Set when scene i's label shows; values are clamped inside the scene. */
  function editLabel(i: number, start: number, end: number) {
    const [a, b] = timings[i];
    const st = r2(Math.min(Math.max(start, a), b - MIN_CUE));
    patchScene(i, {
      label_start: st,
      label_end: r2(Math.min(Math.max(end, st + MIN_CUE), b)),
    });
  }

  function dragLabel(
    e: ReactPointerEvent,
    i: number,
    mode: "move" | "start" | "end",
  ) {
    const [l0, l1] = labelWindow(
      project.scenes[i],
      timings[i][0],
      timings[i][1],
    );
    const grab = timeAt(e.clientX);
    drag(e, (time) => {
      if (mode === "start") editLabel(i, Math.min(time, l1 - MIN_CUE), l1);
      else if (mode === "end") editLabel(i, l0, Math.max(time, l0 + MIN_CUE));
      else {
        const [a, b] = timings[i];
        const start = Math.min(Math.max(l0 + time - grab, a), b - (l1 - l0));
        editLabel(i, start, start + (l1 - l0));
      }
    });
  }

  const closeSound = useCallback(() => setEditing(null), []);

  function openSound(id: string) {
    setPicked(id);
    setEditing(id);
  }

  const patchSound = (id: string, patch: Partial<SoundClip>) =>
    onProject((p) => ({
      ...p,
      sounds: p.sounds.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  function dragSound(
    e: ReactPointerEvent,
    c0: SoundClip,
    mode: "move" | "length",
  ) {
    setPicked(c0.id);
    const grab = timeAt(e.clientX);
    const x0 = e.clientX;
    if (mode === "move")
      e.currentTarget.addEventListener(
        "pointerup",
        (ev) => {
          if (Math.abs((ev as PointerEvent).clientX - x0) >= CLICK_SLOP) return;
          patchSound(c0.id, { start: c0.start }); // a click, however shaky, isn't a move
          openSound(c0.id);
        },
        { once: true },
      );
    drag(e, (time) => {
      if (mode === "length")
        patchSound(c0.id, {
          length: r2(
            Math.min(Math.max(time - c0.start, MIN_SOUND), total - c0.start),
          ),
        });
      else
        patchSound(c0.id, {
          start: r2(
            Math.min(Math.max(c0.start + time - grab, 0), total - MIN_SOUND),
          ),
        });
    });
  }

  if (!project.voiceover || !project.scenes.length) {
    return (
      <p className="text-sm text-muted">
        Upload a voiceover (step 2) and add your script (step 3) to preview the
        video here.
      </p>
    );
  }

  let current = 0;
  while (current < timings.length - 1 && t >= timings[current + 1][0])
    current++;
  const cues = cuesOf(current);
  const shown = project.scenes[current].show_captions !== false;
  const manual = shown && project.scenes[current].captions !== null;
  const pct = (v: number) => `${(v / total) * 100}%`;
  const ticks = Array.from(
    { length: Math.floor(total / 5) + 1 },
    (_, k) => k * 5,
  );
  const rows = soundRows(project.sounds);
  const editingClip = project.sounds.find((c) => c.id === editing);
  const rowCount = Math.max(1, ...[...rows.values()].map((r) => r + 1));
  const captionWords = [
    ...new Map(
      timings
        .flatMap((_, i) => cuesOf(i))
        .flatMap((c) => c.text.split(/\s+/))
        .filter(normWord)
        .map((w) => [normWord(w), w]),
    ).values(),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onSync} disabled={syncing} className="btn-primary">
          {syncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <AudioLines className="size-4" />
          )}{" "}
          Auto-sync to voiceover
        </button>
        <span className="text-sm text-muted">
          {syncing
            ? (syncJob?.step ?? "Starting…")
            : "Listens to the audio and times every scene and caption to the spoken words."}
        </span>
      </div>
      {syncError && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {syncError}
        </p>
      )}
      {syncNote && (
        <p className="mt-3 rounded-lg bg-amber/10 px-3 py-2 text-sm text-amber">
          {syncNote}
        </p>
      )}

      <div className="mt-6 flex flex-col items-center gap-6 lg:flex-row lg:items-start">
        <div className="shrink-0">
          <PreviewFrame
            project={project}
            timings={timings}
            t={t}
            playing={playing}
            width={270}
          />
          <audio
            ref={voice}
            src={project.voiceover.url}
            preload="auto"
            onEnded={() => setPlaying(false)}
          />
          {project.music && (
            <audio ref={music} src={project.music.url} preload="auto" loop />
          )}
          {project.sounds.map((c) => (
            <audio
              key={c.id}
              ref={(el) => {
                if (el) players.current.set(c.id, el);
                else players.current.delete(c.id);
              }}
              src={c.url}
              preload="auto"
              loop
              muted
            />
          ))}
          <p className="mt-2 text-center text-[11px] text-muted/70">
            Preview (rendered video may differ slightly)
          </p>
        </div>

        <div className="w-full min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110"
              title={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-5 fill-white" />
              ) : (
                <Play className="ml-0.5 size-5 fill-white" />
              )}
            </button>
            <span className="font-mono text-sm tabular-nums">
              {t.toFixed(1)}s{" "}
              <span className="text-muted">/ {formatSeconds(total)}</span>
            </span>
            <span className="ml-auto text-xs text-muted">
              Scene {current + 1} · {timings[current][0].toFixed(1)}–
              {timings[current][1].toFixed(1)}s
            </span>
          </div>

          {/* timeline */}
          <div
            ref={track}
            className="relative mt-4 cursor-pointer touch-none select-none"
            onPointerDown={(e) => drag(e, seek)}
          >
            <div className="relative h-5 text-[10px] text-muted">
              {ticks.map((x) => (
                <span
                  key={x}
                  className="absolute -translate-x-1/2"
                  style={{ left: pct(x) }}
                >
                  {x}s
                </span>
              ))}
            </div>
            <div className="text-[10px] font-semibold tracking-wide text-muted uppercase">
              Scenes · drag the edges
            </div>
            <div className="relative mt-1 h-11 rounded-lg bg-ink ring-1 ring-line">
              {timings.map(([a, b], i) => {
                const sc = project.scenes[i];
                return (
                  <div
                    key={sc.id}
                    className={`absolute inset-y-0 overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight ${
                      i === current
                        ? "border-sky bg-brand/40"
                        : i % 2
                          ? "border-line bg-white/10"
                          : "border-line bg-white/5"
                    }`}
                    style={{ left: pct(a), width: pct(b - a) }}
                    title={sc.voiceover}
                  >
                    <b>{i + 1}</b> {sc.rank ? `#${sc.rank} ` : ""}
                    <span className="text-muted">
                      {sc.rank_name || sc.label}
                    </span>
                  </div>
                );
              })}
              {timings.slice(1).map(([a], k) => (
                <div
                  key={k}
                  onPointerDown={(e) =>
                    drag(e, (time) => moveBoundary(k + 1, time))
                  }
                  className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize pointer-coarse:w-6"
                  style={{ left: pct(a) }}
                  title="Drag to change where the scene changes"
                >
                  <div className="mx-auto h-full w-1 rounded bg-sky/80 hover:bg-white" />
                </div>
              ))}
            </div>

            {s.labels !== false && (
              <>
                <div className="mt-3 text-[10px] font-semibold tracking-wide text-muted uppercase">
                  Labels · drag to move, edges to resize
                </div>
                <div className="relative mt-1 h-9 rounded-lg bg-ink ring-1 ring-line">
                  {timings.map(([a, b], i) => {
                    const sc = project.scenes[i];
                    if (!sc.label.trim() || sc.show_label === false)
                      return null;
                    const [l0, l1] = labelWindow(sc, a, b);
                    const custom =
                      sc.label_start !== null || sc.label_end !== null;
                    return (
                      <div
                        key={sc.id}
                        onPointerDown={(e) => dragLabel(e, i, "move")}
                        className={`absolute inset-y-1 cursor-grab overflow-hidden rounded border text-[9px] leading-6 whitespace-nowrap active:cursor-grabbing ${
                          custom
                            ? "border-sky/70 bg-brand/40"
                            : "border-brand/40 bg-brand/20"
                        }`}
                        style={{
                          left: pct(l0),
                          width: pct(Math.max(l1 - l0, 0)),
                        }}
                        title={`${sc.label} (${l0.toFixed(2)}–${l1.toFixed(2)}s)`}
                      >
                        <span
                          onPointerDown={(e) => dragLabel(e, i, "start")}
                          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/50 pointer-coarse:w-3"
                        />
                        <span className="px-1.5">{sc.label}</span>
                        <span
                          onPointerDown={(e) => dragLabel(e, i, "end")}
                          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/50 pointer-coarse:w-3"
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {s.captions && (
              <>
                <div className="mt-3 text-[10px] font-semibold tracking-wide text-muted uppercase">
                  Captions · drag to move, edges to resize
                </div>
                <div className="relative mt-1 h-9 rounded-lg bg-ink ring-1 ring-line">
                  {timings.map((_, i) =>
                    cuesOf(i).map((c, j) => (
                      <div
                        key={`${i}-${j}`}
                        onPointerDown={(e) => dragCue(e, i, j, "move")}
                        className={`absolute inset-y-1 cursor-grab overflow-hidden rounded border text-[9px] leading-6 whitespace-nowrap active:cursor-grabbing ${
                          project.scenes[i].captions?.length
                            ? "border-amber/60 bg-amber/20"
                            : "border-line bg-white/10"
                        }`}
                        style={{
                          left: pct(c.start),
                          width: pct(c.end - c.start),
                        }}
                        title={`${c.text} (${c.start.toFixed(2)}–${c.end.toFixed(2)}s)`}
                      >
                        <span
                          onPointerDown={(e) => dragCue(e, i, j, "start")}
                          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/50 pointer-coarse:w-3"
                        />
                        <span className="px-1.5">{c.text}</span>
                        <span
                          onPointerDown={(e) => dragCue(e, i, j, "end")}
                          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/50 pointer-coarse:w-3"
                        />
                      </div>
                    )),
                  )}
                </div>
              </>
            )}

            <div className="mt-3 text-[10px] font-semibold tracking-wide text-muted uppercase">
              Sound effects · click to trim, drag to move, right edge to change
              length
            </div>
            <div
              className="relative mt-1 overflow-hidden rounded-lg bg-ink ring-1 ring-line"
              style={{ height: rowCount * SOUND_ROW + 6 }}
            >
              {project.sounds.map((c) => (
                <div
                  key={c.id}
                  onPointerDown={(e) => dragSound(e, c, "move")}
                  className={`absolute min-w-3 cursor-grab overflow-hidden rounded border text-[9px] leading-6 whitespace-nowrap active:cursor-grabbing ${
                    picked === c.id
                      ? "border-white bg-emerald-400/40"
                      : "border-emerald-400/60 bg-emerald-400/20"
                  }`}
                  style={{
                    left: pct(c.start),
                    width: pct(c.length),
                    top: 3 + (rows.get(c.id) ?? 0) * SOUND_ROW,
                    height: SOUND_ROW - 4,
                  }}
                  title={`${c.name} (${c.start.toFixed(2)}–${(c.start + c.length).toFixed(2)}s)`}
                >
                  <span className="px-1.5">{c.name}</span>
                  <span
                    onPointerDown={(e) => dragSound(e, c, "length")}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/50 pointer-coarse:w-3"
                  />
                </div>
              ))}
            </div>
            <div
              className="pointer-events-none absolute top-5 bottom-0 z-20 w-0.5 bg-red-400"
              style={{ left: pct(t) }}
            />
          </div>

          <SoundPanel
            project={project}
            t={t}
            total={total}
            picked={picked}
            onPick={setPicked}
            onSeek={seek}
            onChange={patchSound}
            onEdit={openSound}
            onProject={onProject}
          />
          {editingClip && (
            <SoundEditor
              clip={editingClip}
              total={total}
              onChange={patchSound}
              onRemove={(id) => {
                setEditing(null);
                onProject((p) => ({
                  ...p,
                  sounds: p.sounds.filter((c) => c.id !== id),
                }));
              }}
              onClose={closeSound}
              onListen={() => playing && toggle()}
            />
          )}

          {/* label timing for the scene under the playhead */}
          {(() => {
            const sc = project.scenes[current];
            const [a, b] = timings[current];
            const [l0, l1] = labelWindow(sc, a, b);
            const custom = sc.label_start !== null || sc.label_end !== null;
            const labels = s.labels !== false;
            if (!labels && !s.ranking) return null;
            return (
              <div className="mt-5 rounded-xl bg-ink p-4 ring-1 ring-line">
                <div
                  className={`flex flex-wrap items-center gap-2 ${labels ? "mb-3" : ""}`}
                >
                  <p className="text-sm font-semibold">
                    Scene {current + 1} {labels ? "label" : "ranking list"}
                  </p>
                  {labels && (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${custom ? "bg-sky/15 text-sky" : "bg-white/5 text-muted"}`}
                    >
                      {custom ? "Custom timing" : "Whole scene"}
                    </span>
                  )}
                  {labels && custom && (
                    <button
                      onClick={() =>
                        patchScene(current, {
                          label_start: null,
                          label_end: null,
                        })
                      }
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-white"
                    >
                      <RotateCcw className="size-3" /> Show for whole scene
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-4">
                    {labels && (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        Show label
                        <Switch
                          on={sc.show_label !== false}
                          onChange={(v) =>
                            patchScene(current, { show_label: v })
                          }
                          label="Show the label in this scene"
                        />
                      </label>
                    )}
                    {s.ranking && (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        Show ranking list
                        <Switch
                          on={sc.show_ranks !== false}
                          onChange={(v) =>
                            patchScene(current, { show_ranks: v })
                          }
                          label="Show the ranking list in this scene"
                        />
                      </label>
                    )}
                  </div>
                </div>
                {labels && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => seek(l0)}
                      className="shrink-0 rounded p-1 text-muted hover:text-white"
                      title="Jump here"
                    >
                      <Play className="size-3" />
                    </button>
                    <input
                      value={sc.label}
                      onChange={(e) =>
                        patchScene(current, { label: e.target.value })
                      }
                      placeholder="No label for this scene, type one to add it"
                      className="input min-w-[calc(100%-2rem)] flex-1 py-1.5 sm:min-w-0"
                    />
                    <input
                      type="number"
                      step={0.1}
                      value={l0.toFixed(2)}
                      disabled={!sc.label.trim()}
                      onChange={(e) =>
                        editLabel(current, Number(e.target.value), l1)
                      }
                      className="input w-20 py-1.5 text-xs disabled:opacity-40"
                      title="Show at (seconds)"
                    />
                    <input
                      type="number"
                      step={0.1}
                      value={l1.toFixed(2)}
                      disabled={!sc.label.trim()}
                      onChange={(e) =>
                        editLabel(current, l0, Number(e.target.value))
                      }
                      className="input w-20 py-1.5 text-xs disabled:opacity-40"
                      title="Hide at (seconds)"
                    />
                    <span className="hidden w-[22px] shrink-0 sm:block" />
                  </div>
                )}
                {labels && sc.label.trim() && (
                  <button
                    onClick={() => editLabel(current, t, Math.max(l1, t + 1))}
                    className="btn-ghost mt-3 px-3 py-1.5 text-xs"
                  >
                    Show from playhead ({t.toFixed(1)}s)
                  </button>
                )}
              </div>
            );
          })()}

          {/* caption editor for the scene under the playhead */}
          {s.captions && (
            <div className="mt-3 rounded-xl bg-ink p-4 ring-1 ring-line">
              <p className="text-sm font-semibold">Caption colors</p>
              <TitleColors
                what="Caption"
                title={captionWords.join(" ")}
                color={project.caption_color}
                highlights={project.caption_highlights}
                onColor={(caption_color) =>
                  onProject((p) => ({ ...p, caption_color }))
                }
                onHighlights={(caption_highlights) =>
                  onProject((p) => ({ ...p, caption_highlights }))
                }
              />
            </div>
          )}
          {s.captions ? (
            <div className="mt-3 rounded-xl bg-ink p-4 ring-1 ring-line">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">
                  Scene {current + 1} captions
                </p>
                {shown && (
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${manual ? "bg-amber/15 text-amber" : "bg-white/5 text-muted"}`}
                  >
                    {manual ? "Manual timing" : "Automatic (split evenly)"}
                  </span>
                )}
                {manual && (
                  <button
                    onClick={() => setCues(current, null)}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-white"
                  >
                    <RotateCcw className="size-3" /> Reset to automatic
                  </button>
                )}
                <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                  Show captions in this scene
                  <Switch
                    on={shown}
                    onChange={(v) => patchScene(current, { show_captions: v })}
                    label="Show captions in this scene"
                  />
                </label>
              </div>
              {!shown ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <EyeOff className="size-4" /> No captions while scene{" "}
                  {current + 1} is on screen. The voiceover still plays.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {cues.map((c, j) => (
                      <div
                        key={j}
                        className="flex flex-wrap items-center gap-2 border-b border-line pb-1.5 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0"
                      >
                        <button
                          onClick={() => seek(c.start)}
                          className="shrink-0 rounded p-1 text-muted hover:text-white"
                          title="Jump here"
                        >
                          <Play className="size-3" />
                        </button>
                        <input
                          value={c.text}
                          onChange={(e) =>
                            editCue(current, j, { text: e.target.value })
                          }
                          className="input min-w-[calc(100%-2rem)] flex-1 py-1.5 sm:min-w-0"
                        />
                        <label
                          className="relative size-6 shrink-0 cursor-pointer rounded-full ring-1 ring-white/25"
                          style={{
                            background: c.color ?? project.caption_color,
                          }}
                          title="Color of this caption"
                        >
                          <input
                            type="color"
                            value={(
                              c.color ?? project.caption_color
                            ).toLowerCase()}
                            onChange={(e) =>
                              editCue(current, j, {
                                color: e.target.value.toUpperCase(),
                              })
                            }
                            className="absolute inset-0 opacity-0"
                            aria-label="Color of this caption"
                          />
                        </label>
                        {c.color && (
                          <button
                            onClick={() => editCue(current, j, { color: null })}
                            className="shrink-0 rounded p-1 text-muted hover:text-white"
                            title="Use the video's caption color"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                        <input
                          type="number"
                          step={0.1}
                          value={c.start.toFixed(2)}
                          onChange={(e) =>
                            editCue(current, j, {
                              start: Number(e.target.value),
                            })
                          }
                          className="input w-20 py-1.5 text-xs"
                          title="Show at (seconds)"
                        />
                        <input
                          type="number"
                          step={0.1}
                          value={c.end.toFixed(2)}
                          onChange={(e) =>
                            editCue(current, j, { end: Number(e.target.value) })
                          }
                          className="input w-20 py-1.5 text-xs"
                          title="Hide at (seconds)"
                        />
                        <button
                          onClick={() =>
                            setCues(
                              current,
                              cues.filter((_, k) => k !== j),
                            )
                          }
                          className="shrink-0 rounded p-1 text-muted hover:text-red-300"
                          title="Delete caption"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const [, b] = timings[current];
                      const start = r2(Math.min(t, b - MIN_CUE));
                      setCues(
                        current,
                        [
                          ...cues,
                          {
                            text: "New caption",
                            start,
                            end: r2(Math.min(start + 1.5, b)),
                          },
                        ].sort((x, y) => x.start - y.start),
                      );
                    }}
                    className="btn-ghost mt-3 px-3 py-1.5 text-xs"
                  >
                    <Plus className="size-3.5" /> Add caption at {t.toFixed(1)}s
                  </button>
                  <p className="mt-2 text-[11px] text-muted">
                    Times are seconds from the start of the video. Editing any
                    caption switches this scene to manual timing.
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted">
              Captions are turned off (step 5).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
