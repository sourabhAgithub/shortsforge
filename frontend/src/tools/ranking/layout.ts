/**
 * Mirror of backend/app/tools/ranking/overlay.py so the live preview matches the rendered video.
 * Keep the numbers in sync with that file.
 */
import type { Project, Slot } from "./types";

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
export const MEDALS: Record<number, string> = { 1: "#FFD54A", 2: "#D9DEE5", 3: "#E39A5B" };
export const TITLE_FONT = '"Title Black"';

const EMOJI = /[\u{1F000}-\u{1FFFF}☀-➿️‍⬀-⯿]/gu;

export const clean = (t: string) => (t ?? "").replace(EMOJI, "").trim();
export const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
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
    const widest = Math.max(0, ...lines.map((l) => measure(l.join(" "), size))) + 2 * strokeFor(size);
    if (widest <= maxW && lines.length * size * 1.15 <= maxH) break;
    size -= 2;
  }
  return size;
}

export function rankMetrics(n: number) {
  const spacing = Math.min(MAX_LINE_SPACING, (LIST_BOTTOM - LIST_TOP) / Math.max(n, 1));
  return { spacing, size: Math.floor(Math.min(80, spacing * 0.6)) };
}

export function fitRankSize(text: string, base: number): number {
  let size = base;
  while (size > 20 && measure(text, size) + 2 * strokeFor(size) > LIST_MAX_W) size -= 2;
  return size;
}

export const countdown = (n: number) => Array.from({ length: n }, (_, i) => n - i);

export function playbackOrder(p: Project): number[] {
  const n = p.slots.length;
  const valid = [...p.order].sort((a, b) => a - b).join() === Array.from({ length: n }, (_, i) => i + 1).join();
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

/** Seconds this slot will play for (max seconds if the clip isn't downloaded yet). */
export function slotSeconds(slot: Slot, maxSeconds: number): number {
  if (!slot.clip) return maxSeconds;
  const start = Math.max(0, slot.start ?? 0);
  const end = slot.end && slot.end > start ? Math.min(slot.end, slot.clip.duration) : slot.clip.duration;
  return Math.max(0, Math.min(end - start, maxSeconds));
}
