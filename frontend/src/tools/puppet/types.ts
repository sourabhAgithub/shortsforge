import type { PartId } from "./figure";

export type Action = {
  id: string;
  motion: string;
  seconds: number;
  to: number | null; // walk to this spot (0 = left, 1 = right) during the action
  face: "auto" | "front" | "left" | "right";
};

export type Person = {
  id: string;
  parts: Partial<Record<PartId, string>>;
  character: string | null;
  accessories: Record<string, string>; // slot -> item
  start_x: number;
  scale: number;
  actions: Action[];
};

export type Prop = {
  id: string;
  kind: string;
  x: number; // bottom middle of it, 0-1 across and down the frame
  y: number;
  scale: number;
  flip: boolean;
  front: boolean; // in front of the people
};

export type PuppetProject = {
  id: string;
  title: string;
  characters: Person[];
  props: Prop[];
  bg_color: string;
  ground_color: string;
  last_video_id: string | null;
};

export type Motion = { id: string; label: string; seconds: number };
