/**
 * Mirror of backend/app/tools/ranking/overlay.py so the live preview matches the rendered video.
 * Keep the numbers in sync with that file.
 */
import type { Project, RankSettings, Slot } from "./types";

export const W = 1080;
export const H = 1920;
export const BAND_H = 420;
export const TITLE_MARGIN_X = 50;
export const TITLE_MARGIN_Y = 40;
export const LIST_TOP = BAND_H + 50;
export const LIST_BOTTOM = H - 160;
export const LIST_X = 40;
export const LIST_MAX_W = W - 2 * LIST_X;
export const MAX_LINE_SPACING = 170;
export const MEDALS: Record<number, string> = {
  1: "#FFD54A",
  2: "#D9DEE5",
  3: "#E39A5B",
};
export const TITLE_FONT = '"Title Black"';

const EMOJI = /[\u{1F000}-\u{1FFFF}☀-➿️‍⬀-⯿]/gu;

export const clean = (t: string) => (t ?? "").replace(EMOJI, "").trim();
export const normWord = (w: string) =>
  w.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
export const strokeFor = (size: number) => Math.max(3, Math.round(size * 0.09));

let ctx: CanvasRenderingContext2D | null = null;
export function measure(text: string, size: number): number {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * 0.6;
  ctx.font = `${size}px ${TITLE_FONT}`;
  return ctx.measureText(text).width;
}

export function titleLines(title: string): string[][] {
  let lines = clean(title)
    .split("\n")
    .map((l) => l.split(/\s+/).filter(Boolean))
    .filter((l) => l.length);
  if (lines.length > 2) lines = [lines[0], lines.slice(1).flat()];
  return lines;
}

export function fitTitleSize(lines: string[][], requested: number): number {
  const maxW = W - 2 * TITLE_MARGIN_X;
  const maxH = BAND_H - 2 * TITLE_MARGIN_Y;
  let size = Math.max(24, requested);
  while (size > 24) {
    const widest =
      Math.max(0, ...lines.map((l) => measure(l.join(" "), size))) +
      2 * strokeFor(size);
    if (widest <= maxW && lines.length * size * 1.15 <= maxH) break;
    size -= 2;
  }
  return size;
}

export function rankMetrics(n: number) {
  const spacing = Math.min(
    MAX_LINE_SPACING,
    (LIST_BOTTOM - LIST_TOP) / Math.max(n, 1),
  );
  return { spacing, size: Math.floor(Math.min(80, spacing * 0.6)) };
}

export function fitRankSize(text: string, base: number): number {
  let size = base;
  while (size > 20 && measure(text, size) + 2 * strokeFor(size) > LIST_MAX_W)
    size -= 2;
  return size;
}

export const countdown = (n: number) =>
  Array.from({ length: n }, (_, i) => n - i);

export function playbackOrder(p: Project): number[] {
  const n = p.slots.length;
  const valid =
    [...p.order].sort((a, b) => a - b).join() ===
    Array.from({ length: n }, (_, i) => i + 1).join();
  return p.custom_order && valid ? p.order : countdown(n);
}

/** Random order that still ends on #1 (the payoff). */
export function shuffledOrder(n: number): number[] {
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 2);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...rest, 1];
}

/** Where this slot starts in its clip and how long it plays (plan_segments() in render.py). */
export function slotRange(
  slot: Slot,
  s: Pick<RankSettings, "max_seconds" | "clip_length">,
): { start: number; length: number } {
  if (!slot.clip) return { start: 0, length: s.max_seconds };
  const dur = slot.clip.duration;
  const start = Math.min(Math.max(slot.start ?? 0, 0), Math.max(dur - 0.5, 0));
  const end = Math.min(slot.end && slot.end > start ? slot.end : dur, dur);
  const length =
    s.clip_length === "full"
      ? end - start
      : Math.min(end - start, s.max_seconds);
  return { start, length: Math.max(0, Math.round(length * 30) / 30) };
}

/** Seconds this slot will play for (max seconds if the clip isn't downloaded yet). */
export const slotSeconds = (
  slot: Slot,
  s: Pick<RankSettings, "max_seconds" | "clip_length">,
) => slotRange(slot, s).length;

export const AREA_H = H - BAND_H;

/**
 * Where the whole clip sits (in video pixels) so the right part shows in the clip area.
 * Mirrors video_filter() in render.py: zoom cuts a 1/zoom window at pan_x/pan_y, then "fill"
 * covers the area (overflow cropped at the same pan) and "fit" shows the window whole.
 * `window` is the visible box for "fit" (the clip area for "fill").
 */
export function cropBox(
  slot: Slot,
  fit: "fit" | "fill",
  areaW = W,
  areaH = AREA_H,
) {
  const sw = slot.clip?.width || 1920;
  const sh = slot.clip?.height || 1080;
  const z = Math.max(1, slot.zoom ?? 1);
  const px = slot.pan_x ?? 0.5;
  const py = slot.pan_y ?? 0.5;
  const cw = sw / z;
  const ch = sh / z;
  const cx = (sw - cw) * px;
  const cy = (sh - ch) * py;
  if (fit === "fill") {
    const k = Math.max(areaW / cw, areaH / ch);
    const ox = (cw * k - areaW) * px;
    const oy = (ch * k - areaH) * py;
    return {
      window: { left: 0, top: 0, width: areaW, height: areaH },
      video: {
        left: -cx * k - ox,
        top: -cy * k - oy,
        width: sw * k,
        height: sh * k,
      },
    };
  }
  const k = Math.min(areaW / cw, areaH / ch);
  return {
    window: {
      left: (areaW - cw * k) / 2,
      top: (areaH - ch * k) / 2,
      width: cw * k,
      height: ch * k,
    },
    video: { left: -cx * k, top: -cy * k, width: sw * k, height: sh * k },
  };
}
