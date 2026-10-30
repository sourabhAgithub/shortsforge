import type { PartId } from "./figure";

export type Action = {
  id: string;
  motion: string;
  seconds: number;
  to: number | null; // walk to this spot (0 = left, 1 = right) during the action
};

export type PuppetProject = {
  id: string;
  title: string;
  parts: Partial<Record<PartId, string>>;
  bg_color: string;
  ground_color: string;
  start_x: number;
  scale: number;
  actions: Action[];
  last_video_id: string | null;
};

export type Motion = { id: string; label: string; seconds: number };
