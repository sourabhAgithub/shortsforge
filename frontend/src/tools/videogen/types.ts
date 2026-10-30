/** Mirror of backend/app/tools/videogen/models.py. Times are seconds in the finished video. */
export type MediaFile = {
  file: string;
  name: string;
  duration: number;
  url: string;
  has_audio: boolean;
  thumb: string;
};

export type Cue = { text: string; start: number; end: number };

export type TextItem = {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number; // centre, fraction of the frame width
  y: number; // centre, fraction of the frame height
  size: number;
  color: string;
  box: boolean;
  box_color: string;
};

export type Fit = "fill" | "fit_blur" | "fit_black";

export const FITS: [Fit, string][] = [
  ["fill", "Fill frame (crop edges)"],
  ["fit_blur", "Fit whole video (blurred background)"],
  ["fit_black", "Fit whole video (black bars)"],
];

export type VgSettings = {
  fit: Fit;
  trim_start: number;
  trim_end: number | null; // null = to the end of the video
  video_sound: boolean;
  video_volume: number;
  audio_volume: number;
  audio_start: number;
  captions: boolean;
  caption_y: number;
  caption_size: number;
  caption_color: string;
};

export type VgProject = {
  id: string;
  tool: "videogen";
  title: string;
  video: MediaFile | null;
  audio: MediaFile | null;
  captions: Cue[];
  texts: TextItem[];
  settings: VgSettings;
  created_at: number;
  updated_at: number;
  last_video_id: string | null;
};

/** Mirror of window() in render.py: the used part of the source video, in source seconds. */
export function trimWindow(p: VgProject): [number, number] {
  const len = p.video?.duration ?? 0;
  const start = Math.min(Math.max(p.settings.trim_start, 0), len);
  const end =
    p.settings.trim_end === null
      ? len
      : Math.min(Math.max(p.settings.trim_end, start), len);
  return [start, end];
}

export function newText(at: number, length: number): TextItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    text: "",
    start: Math.round(at * 10) / 10,
    end: Math.round(Math.min(at + 3, Math.max(length, at + 0.5)) * 10) / 10,
    x: 0.5,
    y: 0.3,
    size: 90,
    color: "#FFFFFF",
    box: false,
    box_color: "#5669FF",
  };
}
