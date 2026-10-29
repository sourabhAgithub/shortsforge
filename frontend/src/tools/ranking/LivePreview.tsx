import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatSeconds } from "../../api";
import FramedClip from "./FramedClip";
import { playbackOrder, slotRange } from "./layout";
import PhonePreview from "./PhonePreview";
import type { Project, Slot } from "./types";

type Seg = {
  rank: number;
  slot: Slot;
  start: number;
  length: number;
  t0: number;
};

function segmentsOf(project: Project): Seg[] {
  let t0 = 0;
  return playbackOrder(project).map((rank) => {
    const slot = project.slots[rank - 1];
    const { start, length } = slotRange(slot, project.settings);
    const seg = { rank, slot, start, length, t0 };
    t0 += length;
    return seg;
  });
}

/**
 * The finished video, played live in the browser: the clips in playback order with their trim,
 * crop, sound and overlays. Every edit shows up straight away; nothing is rendered.
 */
export default function LivePreview({ project }: { project: Project }) {
  const segs = segmentsOf(project);
  const total = segs.reduce((sum, x) => sum + x.length, 0);
  const s = project.settings;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const music = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const clock = useRef({ t: 0, last: 0 });

  const time = Math.min(t, total);
  let i = 0;
  while (i < segs.length - 1 && time >= segs[i + 1].t0) i++;
  const seg = segs[i];
  const local = seg ? Math.min(time - seg.t0, seg.length) : 0;

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    clock.current = { t: time >= total ? 0 : time, last: performance.now() };
    let raf = 0;
    const tick = (now: number) => {
      const c = clock.current;
      c.t += (now - c.last) / 1000;
      c.last = now;
      if (c.t >= total) {
        setT(total);
        setPlaying(false);
        return;
      }
      setT(c.t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  // Keep the clip videos in step with the clock: the current one plays, the others wait at their start.
  useEffect(() => {
    segs.forEach((x, k) => {
      const v = videos.current.get(x.slot.id);
      if (!v || !v.readyState) return;
      if (k === i) {
        const want = x.start + local;
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
        const own = s.audio_mode !== "external" && !x.slot.mute;
        v.muted = !own;
        v.volume = Math.min(1, s.original_volume);
        if (playing && v.paused) v.play().catch(() => {});
        if (!playing && !v.paused) v.pause();
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - x.start) > 0.05) v.currentTime = x.start;
      }
    });
    const a = music.current;
    if (a && a.duration) {
      const on = s.audio_mode !== "original";
      const want = time % a.duration;
      if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
      a.volume = Math.min(1, s.external_volume);
      a.muted = !on;
      if (playing && on && a.paused) a.play().catch(() => {});
      if ((!playing || !on) && !a.paused) a.pause();
    }
  });

  function seek(e: React.PointerEvent) {
    const el = track.current;
    if (!el) return;
    const move = (x: number) => {
      const r = el.getBoundingClientRect();
      const v = Math.min(Math.max((x - r.left) / r.width, 0), 1) * total;
      clock.current.t = v;
      setT(v);
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const jump = (v: number) => {
    clock.current.t = v;
    setT(v);
  };

  // All clips stay mounted (preloaded) so switching between them doesn't flash.
  const clipArea = (
    <div className="relative size-full">
      {segs.map((x, k) =>
        x.slot.clip ? (
          <div
            key={x.slot.id}
            className="absolute inset-0"
            style={{ visibility: k === i ? "visible" : "hidden" }}
          >
            <FramedClip
              slot={x.slot}
              fit={s.fit_mode}
              media={(style, background) =>
                background ? (
                  <img
                    src={x.slot.clip!.thumb}
                    alt=""
                    className="absolute max-w-none"
                    style={style}
                  />
                ) : (
                  <video
                    ref={(el) => {
                      if (el) videos.current.set(x.slot.id, el);
                      else videos.current.delete(x.slot.id);
                    }}
                    src={x.slot.clip!.video}
                    preload="auto"
                    playsInline
                    muted
                    className="absolute max-w-none object-fill"
                    style={style}
                    onLoadedMetadata={(e) =>
                      (e.currentTarget.currentTime = x.start)
                    }
                  />
                )
              }
            />
          </div>
        ) : (
          k === i && (
            <div
              key={x.slot.id}
              className="grid size-full place-items-center bg-gradient-to-br from-[#1a1d3a] to-[#0d1424]"
            >
              <span className="font-sans text-[56px] font-bold text-white/25">
                Rank {x.rank}: no clip yet
              </span>
            </div>
          )
        ),
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start">
      <div className="shrink-0">
        <PhonePreview project={project} step={i} clip={clipArea} />
        {project.external_audio && (
          <audio
            ref={music}
            src={project.external_audio.url}
            preload="auto"
            loop
          />
        )}
      </div>

      <div className="w-full min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPlaying((v) => !v)}
            disabled={total <= 0}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110 disabled:opacity-40"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="size-5 fill-white" />
            ) : (
              <Play className="ml-0.5 size-5 fill-white" />
            )}
          </button>
          <button
            onClick={() => jump(0)}
            className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-white"
            title="Back to the start"
          >
            <RotateCcw className="size-4" />
          </button>
          <span className="font-mono text-sm tabular-nums">
            {time.toFixed(1)}s{" "}
            <span className="text-muted">/ {formatSeconds(total)}</span>
          </span>
          {seg && (
            <span className="ml-auto text-xs text-muted">
              Now playing: rank #{seg.rank}
            </span>
          )}
        </div>

        <div
          ref={track}
          onPointerDown={seek}
          className="relative mt-4 h-12 cursor-pointer touch-none rounded-lg bg-ink ring-1 ring-line select-none"
        >
          {segs.map((x, k) => (
            <div
              key={x.slot.id}
              className={`absolute inset-y-0 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight ${
                k === i
                  ? "border-sky bg-brand/40"
                  : k % 2
                    ? "border-line bg-white/10"
                    : "border-line bg-white/5"
              }`}
              style={{
                left: `${(x.t0 / (total || 1)) * 100}%`,
                width: `${(x.length / (total || 1)) * 100}%`,
              }}
              title={`#${x.rank} ${x.slot.caption}: ${x.length.toFixed(1)}s`}
            >
              <b>#{x.rank}</b>{" "}
              <span className="text-muted">{x.slot.caption}</span>
            </div>
          ))}
          <div
            className="pointer-events-none absolute -inset-y-1 z-10 w-0.5 bg-red-400"
            style={{ left: `${(time / (total || 1)) * 100}%` }}
          />
        </div>

        <div className="mt-4 space-y-1.5">
          {segs.map((x, k) => (
            <button
              key={x.slot.id}
              onClick={() => jump(x.t0 + 0.01)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${k === i ? "bg-brand/15 text-white" : "bg-white/5 text-muted hover:text-white"}`}
            >
              <b className="w-8 shrink-0">#{x.rank}</b>
              <span className="min-w-0 flex-1 truncate">
                {x.slot.caption || (x.slot.clip ? "No caption" : "No clip yet")}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                {x.slot.clip
                  ? `${x.start.toFixed(1)}–${(x.start + x.length).toFixed(1)}s of clip`
                  : "—"}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          This plays your real clips with every trim, crop and sound setting, so
          you can check the video before generating. The rendered file may
          differ very slightly.
        </p>
      </div>
    </div>
  );
}
