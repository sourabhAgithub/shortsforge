export type MediaFile = {
  file: string;
  name: string;
  duration: number;
  url: string;
};

export type Footage = {
  kind: "image" | "video" | "gradient";
  source: "upload" | "ai" | "stock" | "gradient";
  file: string | null;
  thumb: string | null;
  note: string;
};

export type Motion =
  | "auto"
  | "still"
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down";

export const MOTIONS: [Motion, string][] = [
  ["auto", "Auto (varies per scene)"],
  ["still", "Keep still"],
  ["zoom_in", "Zoom in"],
  ["zoom_out", "Zoom out"],
  ["pan_left", "Pan left"],
  ["pan_right", "Pan right"],
  ["pan_up", "Pan up"],
  ["pan_down", "Pan down"],
];

/** Mirror of image_motion() in render.py. */
export const imageMotion = (m: Motion, index: number): Motion =>
  m === "auto" ? (["zoom_in", "zoom_out", "pan_right"] as const)[index % 3] : m;

export type Fit = "fill" | "fit_blur" | "fit_black" | "fullscreen";

export const FITS: [Fit, string][] = [
  ["fill", "Fill frame (crop edges)"],
  ["fit_blur", "Fit whole image (blurred background)"],
  ["fit_black", "Fit whole image (black bars)"],
  ["fullscreen", "Full screen (covers the title banner)"],
];

export type Cue = {
  text: string;
  start: number;
  end: number;
  color?: string | null; // null = the video's caption colour
};

/** A sound on the effects track. Longer than the part of the file it keeps = it loops. */
export type SoundClip = {
  id: string;
  file: string;
  name: string;
  url: string;
  duration: number; // of the file
  start: number;
  length: number;
  volume: number;
  trim_start: number; // seconds cut off the start of the file
  trim_end: number; // seconds cut off the end of the file
  speed: number; // 2 = twice as fast, at the same pitch
  credit: string; // who made it and its licence, for sounds from the free library
};

/** Seconds of the file a clip keeps. Mirrors SoundClip.part in models.py. */
export const soundPart = (c: SoundClip) =>
  Math.max(c.duration - c.trim_start - c.trim_end, 0.05);

/** Seconds the kept part lasts at the clip's speed. Mirrors SoundClip.played in models.py. */
export const soundPlayed = (c: SoundClip) => soundPart(c) / c.speed;

/** Fills in fields a project saved by an older version of the app doesn't have. */
export const withSoundDefaults = (p: AiProject): AiProject => ({
  ...p,
  sounds: p.sounds.map((c) => ({
    ...c,
    trim_start: c.trim_start ?? 0,
    trim_end: c.trim_end ?? 0,
    speed: c.speed ?? 1,
    credit: c.credit ?? "",
  })),
});

/** A free download for a suggested sound. */
export type SoundOption = {
  title: string;
  url: string;
  duration: number;
  licence: string;
  artist: string;
  about: string; // what the uploader says it is
  page: string;
};

export type SoundIdea = {
  sound: string;
  file: string | null; // null = a sound the user doesn't have yet
  start: number;
  length: number;
  ambient: boolean; // runs across a stretch of the video, rather than playing once
  reason: string;
  options?: SoundOption[]; // free downloads, for a sound the user doesn't have
};

export type Scene = {
  id: string;
  start: number | null;
  end: number | null;
  voiceover: string;
  label: string;
  label_start: number | null; // seconds from video start; null = when the scene starts
  label_end: number | null; // null = until the scene ends
  prompt: string;
  motion: Motion;
  fit: Fit;
  rank: number | null;
  rank_name: string;
  upload: Footage | null;
  footage: Footage | null;
  captions: Cue[] | null; // null = split the voiceover evenly across the scene
  show_captions: boolean; // false = no captions while this scene is on screen
  show_label: boolean; // false = hide the on-screen label box in this scene
  show_ranks: boolean; // false = hide the ranking list while this scene is on screen
};

export type AiSettings = {
  title: boolean; // false = no title banner; footage fills the whole frame
  captions: boolean;
  labels: boolean;
  ranking: boolean;
  whoosh: boolean;
  music_volume: number;
  footage_source: "ai" | "stock" | "uploads";
};

export type AiProject = {
  id: string;
  tool: "aivideo";
  title: string;
  title_color: string;
  title_highlights: Record<string, string>; // normalised word -> colour
  caption_color: string;
  caption_highlights: Record<string, string>; // normalised word -> colour
  voiceover: MediaFile | null;
  music: MediaFile | null;
  sounds: SoundClip[];
  script_text: string;
  scenes: Scene[];
  settings: AiSettings;
  created_at: number;
  updated_at: number;
  last_video_id: string | null;
};

export function newScene(): Scene {
  return {
    id: Math.random().toString(36).slice(2, 10),
    start: null,
    end: null,
    voiceover: "",
    label: "",
    label_start: null,
    label_end: null,
    prompt: "",
    motion: "auto",
    fit: "fill",
    rank: null,
    rank_name: "",
    upload: null,
    footage: null,
    captions: null,
    show_captions: true,
    show_label: true,
    show_ranks: true,
  };
}

export const isBlank = (s: Scene) =>
  !(s.voiceover.trim() || s.label.trim() || s.prompt.trim() || s.upload);

/** Mirror of resolve_timings() in backend/app/tools/aivideo/script.py (for display only). */
export function resolveTimings(
  scenes: Scene[],
  total: number,
): [number, number][] {
  const n = scenes.length;
  if (!n) return [];
  const starts = scenes.map((s) => s.start);
  if (starts.every((v) => v !== null)) {
    const scriptEnd = Math.max(
      ...scenes.map((s) => s.end ?? 0),
      (starts[n - 1] as number) + 0.5,
    );
    const scale =
      Math.abs(scriptEnd - total) > 1 && scriptEnd > 0 ? total / scriptEnd : 1;
    const bounds = [
      0,
      ...starts.slice(1).map((v) => Math.min((v as number) * scale, total)),
      total,
    ];
    if (bounds.every((b, i) => i === 0 || b - bounds[i - 1] >= 0.5))
      return scenes.map((_, i) => [bounds[i], bounds[i + 1]]);
  }
  const weights = scenes.map((s) =>
    Math.max(1, (s.voiceover.match(/[\p{L}\p{N}_]+/gu) ?? []).length),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return weights.map((w, i) => {
    const d = (total * w) / sum;
    const out: [number, number] = [t, i === n - 1 ? total : t + d];
    t += d;
    return out;
  });
}

/** Mirror of caption_chunks() in script.py: 2–4 words per caption, sizes as even as possible. */
export function captionChunks(text: string): string[] {
  const words = text
    .replace(/\[[a-z][a-z' -]*\]/gi, " ") // delivery tags like [whispers] aren't spoken
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  if (words.length <= 4) return [words.join(" ")];
  const n = Math.ceil(words.length / 3);
  const base = Math.floor(words.length / n);
  const extra = words.length % n;
  const out: string[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const size = base + (k < extra ? 1 : 0);
    out.push(words.slice(i, i + size).join(" "));
    i += size;
  }
  return out;
}

/** The captions a scene will show (its manual ones, or the voiceover split evenly), clipped to [a, b]. */
export function sceneCues(scene: Scene, a: number, b: number): Cue[] {
  if (scene.show_captions === false) return [];
  if (scene.captions) {
    return scene.captions
      .map((c) => ({
        ...c,
        start: Math.max(c.start, a),
        end: Math.min(c.end, b),
      }))
      .filter((c) => c.text.trim() && c.end - c.start > 0.05);
  }
  const chunks = captionChunks(scene.voiceover);
  const d = (b - a) / Math.max(chunks.length, 1);
  return chunks.map((text, j) => ({
    text,
    start: a + d * j,
    end: a + d * (j + 1),
  }));
}

/** Which row of the effects track each clip sits on, so clips that overlap stay visible. */
export function soundRows(clips: SoundClip[]): Map<string, number> {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const c of [...clips].sort((x, y) => x.start - y.start)) {
    let row = ends.findIndex((end) => end <= c.start);
    if (row < 0) row = ends.length;
    ends[row] = c.start + c.length;
    rows.set(c.id, row);
  }
  return rows;
}

/** Mirror of label_window() in render.py: when the label is on screen (the whole scene unless set). */
export function labelWindow(
  scene: Scene,
  a: number,
  b: number,
): [number, number] {
  const start =
    scene.label_start === null
      ? a
      : Math.min(Math.max(scene.label_start, a), b);
  const end =
    scene.label_end === null
      ? b
      : Math.min(Math.max(scene.label_end, start), b);
  return [start, end];
}
