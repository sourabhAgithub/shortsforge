import type { Clip } from "../../api";

export type Highlight = { word: string; color: string };

export type Slot = {
  id: string;
  url: string;
  caption: string;
  clip: Clip | null;
  start: number | null;
  end: number | null;
};

export type RankSettings = {
  max_seconds: number;
  fit_mode: "fit" | "fill";
  title_font_size: number;
  keyword_color: string;
  highlight_color: string;
  medal_colors: boolean;
};

export type Project = {
  id: string;
  tool: "ranking";
  title: string;
  highlights: Highlight[];
  slots: Slot[];
  custom_order: boolean;
  order: number[];
  settings: RankSettings;
  created_at: number;
  updated_at: number;
  last_video_id: string | null;
};


export const MIN_SLOTS = 3;
export const MAX_SLOTS = 10;

export function newSlot(): Slot {
  return { id: Math.random().toString(36).slice(2, 10), url: "", caption: "", clip: null, start: null, end: null };
}
