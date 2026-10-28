/**
 * Mirror of backend/app/tools/aivideo/overlay.py (and render.py's gradients) so the preview
 * player matches the rendered video. Keep the numbers in sync with those files.
 */
export const W = 1080;
export const H = 1920;
export const BANNER_H = 260;
export const LIST_X = 28;
export const LIST_TOP = BANNER_H + 36;
export const ROW_H = 100;
export const ROW_FONT = 60;
export const LABEL_CY = 1090;
export const CAPTION_CY = 1650;
export const FLASH = 0.24;
export const GOLD = "rgb(255,201,60)";
export const ACCENT = "rgb(86,105,255)";
export const MEDALS: Record<number, string> = { 1: "#FFD54A", 2: "#D9DEE5", 3: "#E39A5B" };
export const GRADIENTS: [string, string][] = [
  ["#1941e3", "#4bb5ff"],
  ["#7c3aed", "#ec4899"],
  ["#0f766e", "#22d3ee"],
  ["#b45309", "#f43f5e"],
  ["#1e3a8a", "#a855f7"],
  ["#065f46", "#84cc16"],
];
