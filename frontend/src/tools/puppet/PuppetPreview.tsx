import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  drawFigure,
  drawProp,
  GROUND,
  H,
  type Layers,
  sideArt,
  type View,
  W,
} from "./figure";
import type { PuppetProject } from "./types";

const STANDING = [0, 0, 0, 0, 0, 0, 0, 0];
const CSS_WIDTH = 270;

type Props = {
  project: PuppetProject;
  layersOf: (personId: string) => Layers;
  tracks: Record<string, number[][]>;
  fps: number;
  version: number; // bumps when a drawing changes
  selected: string; // the person being drawn
  peek: View | null; // show them standing in this view instead of the story
  onStory: () => void; // back to the story
};

/** Live preview: draws the server's poses, the same ones the render uses. */
export default function PuppetPreview({
  project,
  layersOf,
  tracks,
  fps,
  version,
  selected,
  peek,
  onStory,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const count = Math.max(0, ...Object.values(tracks).map((t) => t.length));
  const last = Math.max(count - 1, 0);
  const shown = Math.min(frame, last);
  const ids = project.characters.map((c) => c.id).join();
  const sides = useMemo(
    () => new Map(ids.split(",").map((id) => [id, sideArt(layersOf(id))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, layersOf, version],
  );

  const paint = useCallback(
    (i: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      const scale = canvas.current!.width / W;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = project.bg_color;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = project.ground_color;
      ctx.fillRect(0, GROUND * H - 10, W, H);
      for (const p of project.props) if (!p.front) drawProp(ctx, p);
      for (const c of project.characters) {
        const row = tracks[c.id]?.[i];
        const side = c.id === selected && peek === "side" ? 1 : 0;
        drawFigure(
          ctx,
          layersOf(c.id),
          peek || !row ? [c.start_x, 1, side, ...STANDING] : row,
          c.scale,
          sides.get(c.id) ?? new Set(),
        );
      }
      for (const p of project.props) if (p.front) drawProp(ctx, p);
    },
    [layersOf, peek, project, selected, sides, tracks],
  );

  useEffect(() => paint(shown), [paint, shown, version]);

  useEffect(() => {
    if (!playing) return;
    const from = performance.now() - (shown / fps) * 1000;
    let raf = 0;
    const tick = (now: number) => {
      const i = Math.floor(((now - from) / 1000) * fps);
      if (i >= last) {
        setFrame(last);
        setPlaying(false);
        return;
      }
      setFrame(i);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, last]);

  function toggle() {
    onStory();
    if (!playing && shown >= last) setFrame(0);
    setPlaying((p) => !p);
  }

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-[2.4rem] bg-gradient-to-b from-white/15 to-white/5 p-2.5 shadow-2xl shadow-black/60">
        <canvas
          ref={canvas}
          width={540}
          height={960}
          className="block rounded-[2rem]"
          style={{ width: CSS_WIDTH, height: (CSS_WIDTH * H) / W }}
        />
      </div>
      <div
        className="mt-4 flex w-full items-center gap-3"
        style={{ maxWidth: CSS_WIDTH + 20 }}
      >
        <button
          onClick={toggle}
          disabled={!count}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110 disabled:opacity-40"
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
          max={last}
          value={shown}
          onChange={(e) => {
            onStory();
            setFrame(Number(e.target.value));
          }}
          disabled={playing || !count}
          className="min-w-0 flex-1 accent-brand"
          aria-label="Playhead"
        />
        <span className="w-20 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
          {(shown / fps).toFixed(1)} / {(last / fps).toFixed(1)}s
        </span>
      </div>
      {peek && (
        <p className="mt-2 text-xs text-muted">
          Showing the {peek} view. Press play to see the story.
        </p>
      )}
    </div>
  );
}
