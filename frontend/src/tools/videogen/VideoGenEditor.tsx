import {
  ArrowLeft,
  AudioLines,
  Check,
  Clock,
  Loader2,
  Music,
  Plus,
  Trash2,
  Type,
  Video as VideoIcon,
  Wand2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  formatSeconds,
  type Job,
  type Video,
  waitForJob,
} from "../../api";
import FileButton from "../../components/FileButton";
import RenderDialog, { type RenderState } from "../../components/RenderDialog";
import Section from "../../components/Section";
import Switch from "../../components/Switch";
import VideoPreview from "./VideoPreview";
import {
  type Cue,
  FITS,
  type Fit,
  type MediaFile,
  newText,
  type TextItem,
  trimWindow,
  type VgProject,
  type VgSettings,
} from "./types";

const r1 = (v: number) => Math.round(v * 10) / 10;

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  );
}

function SwitchRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-ink px-4 py-3 ring-1 ring-line">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  shown,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  shown: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 flex justify-between">
        <span className="font-semibold">{label}</span>
        <span className="text-muted">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </label>
  );
}

/** Seconds field with a button that sets it to the preview's playhead. */
function TimeField({
  label,
  value,
  now,
  onChange,
}: {
  label: string;
  value: number;
  now: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input
        type="number"
        min={0}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="input w-20 px-2 py-1 text-xs"
      />
      <button
        onClick={() => onChange(r1(now))}
        className="rounded-md bg-white/5 px-1.5 py-1 text-[10px] font-semibold hover:bg-white/10 hover:text-white"
        title="Set to the preview's current time"
      >
        Now
      </button>
    </label>
  );
}

export default function VideoGenEditor() {
  const { id } = useParams();
  const [project, setProject] = useState<VgProject | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [t, setT] = useState(0);
  const [capSource, setCapSource] = useState<"video" | "audio">("video");
  const [script, setScript] = useState("");
  const [capJob, setCapJob] = useState<Job | null>(null);
  const [captioning, setCaptioning] = useState(false);
  const [render, setRender] = useState<RenderState | null>(null);

  const latest = useRef<VgProject | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    api<VgProject>(`/api/videogen/projects/${id}`)
      .then((p) => {
        latest.current = p;
        setProject(p);
        if (!p.video?.has_audio && p.audio) setCapSource("audio");
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  // Autosave: debounce edits, and flush on leave (same approach as the other editors).
  useEffect(() => {
    if (!project || !dirty.current) return;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        await api(`/api/videogen/projects/${project.id}`, {
          method: "PUT",
          json: project,
        });
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const flush = () => {
      const p = latest.current;
      if (p && dirty.current) {
        fetch(`/api/videogen/projects/${p.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
          keepalive: true,
        });
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  const update = useCallback((fn: (p: VgProject) => VgProject) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      latest.current = next;
      dirty.current = true;
      return next;
    });
  }, []);

  const patch = (p: Partial<VgProject>) =>
    update((prev) => ({ ...prev, ...p }));
  const patchSettings = (s: Partial<VgSettings>) =>
    update((prev) => ({ ...prev, settings: { ...prev.settings, ...s } }));
  const patchText = (textId: string, x: Partial<TextItem>) =>
    update((prev) => ({
      ...prev,
      texts: prev.texts.map((it) => (it.id === textId ? { ...it, ...x } : it)),
    }));
  const patchCue = (i: number, c: Partial<Cue>) =>
    update((prev) => ({
      ...prev,
      captions: prev.captions.map((x, k) => (k === i ? { ...x, ...c } : x)),
    }));
  const setError = (key: string, msg: string) =>
    setErrors((e) => ({ ...e, [key]: msg }));
  const setBusy = (key: string, v: boolean) =>
    setUploading((u) => ({ ...u, [key]: v }));

  async function upload(kind: "video" | "audio", file: File) {
    setBusy(kind, true);
    setError(kind, "");
    try {
      const body = new FormData();
      body.append("file", file);
      const media = await api<MediaFile>(
        `/api/videogen/projects/${id}/${kind}`,
        {
          method: "POST",
          body,
        },
      );
      if (kind === "video") {
        // A new video starts untrimmed.
        update((p) => ({
          ...p,
          video: media,
          settings: { ...p.settings, trim_start: 0, trim_end: null },
        }));
        setT(0);
        if (!media.has_audio) setCapSource("audio");
      } else {
        patch({ audio: media });
      }
    } catch (e) {
      setError(kind, (e as Error).message);
    } finally {
      setBusy(kind, false);
    }
  }

  async function autoCaptions() {
    if (!latest.current) return;
    if (
      latest.current.captions.length &&
      !confirm("Replace the current captions with new ones from the speech?")
    )
      return;
    setCaptioning(true);
    setError("captions", "");
    try {
      const job = await api<Job<{ captions: Cue[] }>>(
        `/api/videogen/projects/${id}/auto-captions`,
        {
          method: "POST",
          json: { project: latest.current, source: capSource, script },
        },
      );
      const res = await waitForJob(job, setCapJob);
      patch({ captions: res.captions });
    } catch (e) {
      setError("captions", (e as Error).message);
    } finally {
      setCaptioning(false);
      setCapJob(null);
    }
  }

  async function generateVideo() {
    if (!latest.current) return;
    setRender({ job: null });
    try {
      const job = await api<Job<Video>>(`/api/videogen/projects/${id}/render`, {
        method: "POST",
        json: latest.current,
      });
      dirty.current = false;
      const video = await waitForJob(job, (j) => setRender({ job: j }));
      setRender({ job: null, video });
      patch({ last_video_id: video.id });
    } catch (e) {
      setRender({ job: null, error: (e as Error).message });
    }
  }

  if (loadError)
    return (
      <div className="p-10">
        <ErrorLine>{loadError}</ErrorLine>
        <Link to="/videogen" className="btn-ghost mt-4">
          Back to projects
        </Link>
      </div>
    );
  if (!project)
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="size-6 animate-spin text-sky" />
      </div>
    );

  const s = project.settings;
  const v = project.video;
  const [trimA, trimB] = trimWindow(project);
  const length = Math.max(trimB - trimA, 0);
  const busyAny = Object.values(uploading).some(Boolean) || captioning;
  const canListen = capSource === "video" ? !!v?.has_audio : !!project.audio;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/videogen"
          className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-white"
          title="All Video Generator projects"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-sky uppercase">
            Video Generator
          </p>
          <h1 className="text-xl font-black tracking-tight break-words sm:text-2xl">
            {project.title || "Untitled video"}
          </h1>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          {saveState === "saving" && (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </>
          )}
          {saveState === "saved" && (
            <>
              <Check className="size-3.5 text-emerald-400" /> All changes saved
            </>
          )}
          {saveState === "error" && (
            <span className="text-red-300">
              Couldn't save. Is the app still running?
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <Section n={1} title="Name">
            <input
              value={project.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Name this video, e.g. Beach day edit"
              className="input"
            />
            <p className="mt-2 text-xs text-muted">
              Used in My Videos and for the downloaded file. It isn't drawn on
              the video; add text in step 5 for that.
            </p>
          </Section>

          <Section n={2} title="Video">
            <div className="flex flex-wrap items-center gap-3">
              <FileButton
                accept=".mp4,.mov,.m4v,.webm,.mkv,video/*"
                busy={!!uploading.video}
                label={v ? "Replace video" : "Add a video"}
                onFile={(f) => upload("video", f)}
              />
              {v && (
                <span className="inline-flex items-center gap-2 text-sm">
                  <VideoIcon className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 break-all">{v.name}</span> ·{" "}
                  <b>{formatSeconds(v.duration)}</b>
                </span>
              )}
            </div>
            {errors.video && <ErrorLine>{errors.video}</ErrorLine>}
            {v && (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label mb-0">Framing</span>
                  <select
                    value={s.fit}
                    onChange={(e) =>
                      patchSettings({ fit: e.target.value as Fit })
                    }
                    className="input w-full py-1.5 sm:w-72"
                  >
                    {FITS.map(([val, l]) => (
                      <option key={val} value={val}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="label">
                    Trim (seconds in the original video)
                  </span>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      Start
                      <input
                        type="number"
                        min={0}
                        max={v.duration}
                        step={0.1}
                        value={s.trim_start}
                        onChange={(e) =>
                          patchSettings({
                            trim_start: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          })
                        }
                        className="input w-24 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      End
                      <input
                        type="number"
                        min={0}
                        max={v.duration}
                        step={0.1}
                        value={s.trim_end ?? v.duration}
                        onChange={(e) => {
                          const x = Number(e.target.value);
                          patchSettings({
                            trim_end: !x || x >= v.duration ? null : x,
                          });
                        }}
                        className="input w-24 px-2 py-1 text-xs"
                      />
                    </label>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <Clock className="size-3.5 text-muted" /> Final length{" "}
                      <b>{formatSeconds(length)}</b>
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted">
                    Caption and text times count from the trim start (0 = the
                    first frame of the finished video).
                  </p>
                </div>
                {v.has_audio ? (
                  <>
                    <SwitchRow
                      label="Video sound"
                      hint={
                        s.video_sound ? "The video's own sound plays" : "Muted"
                      }
                      on={s.video_sound}
                      onChange={(video_sound) => patchSettings({ video_sound })}
                    />
                    {s.video_sound && (
                      <div className="max-w-sm">
                        <Slider
                          label="Video volume"
                          value={s.video_volume}
                          min={0}
                          max={1}
                          step={0.01}
                          shown={`${Math.round(s.video_volume * 100)}%`}
                          onChange={(video_volume) =>
                            patchSettings({ video_volume })
                          }
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted">This video has no sound.</p>
                )}
              </div>
            )}
          </Section>

          <Section n={3} title="External audio">
            <div className="flex flex-wrap items-center gap-3">
              <FileButton
                accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
                busy={!!uploading.audio}
                label={project.audio ? "Replace audio" : "Add audio (MP3/WAV)"}
                onFile={(f) => upload("audio", f)}
              />
              {project.audio && (
                <span className="inline-flex items-center gap-2 text-sm">
                  <Music className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 break-all">
                    {project.audio.name}
                  </span>{" "}
                  · <b>{formatSeconds(project.audio.duration)}</b>
                  <button
                    onClick={() => patch({ audio: null })}
                    className="rounded p-1 text-muted hover:text-red-300"
                    title="Remove the audio"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              )}
            </div>
            {errors.audio && <ErrorLine>{errors.audio}</ErrorLine>}
            {project.audio && (
              <div className="mt-4 flex flex-wrap items-end gap-6">
                <div className="w-full max-w-sm">
                  <Slider
                    label="Audio volume"
                    value={s.audio_volume}
                    min={0}
                    max={1}
                    step={0.01}
                    shown={`${Math.round(s.audio_volume * 100)}%`}
                    onChange={(audio_volume) => patchSettings({ audio_volume })}
                  />
                </div>
                <TimeField
                  label="Starts at"
                  value={s.audio_start}
                  now={t}
                  onChange={(audio_start) => patchSettings({ audio_start })}
                />
              </div>
            )}
            <p className="mt-2 text-xs text-muted">
              A voiceover or music, mixed with the video's sound. Mute the video
              in step 2 to hear only this. It stops when the video ends.
            </p>
          </Section>

          <Section
            n={4}
            title="Captions"
            aside={
              <Switch
                on={s.captions}
                onChange={(captions) => patchSettings({ captions })}
                label="Show captions"
              />
            }
          >
            <div className="rounded-xl bg-ink p-4 ring-1 ring-line">
              <p className="text-sm font-semibold">Auto captions</p>
              <p className="text-xs text-muted">
                Listens to the speech and times every caption to the spoken
                words.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Listen to</span>
                {(
                  [
                    ["video", "Video sound"],
                    ["audio", "External audio"],
                  ] as const
                ).map(([key, l]) => (
                  <button
                    key={key}
                    onClick={() => setCapSource(key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${capSource === key ? "bg-brand text-white ring-brand" : "text-muted ring-line hover:text-white"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={3}
                placeholder="Optional: paste the exact words that are spoken. Captions then use your spelling, timed to the speech."
                className="input mt-3 resize-y text-sm"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={autoCaptions}
                  disabled={!v || !canListen || captioning}
                  className="btn-primary"
                >
                  {captioning ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <AudioLines className="size-4" />
                  )}{" "}
                  Make captions
                </button>
                <span className="text-xs text-muted">
                  {captioning
                    ? (capJob?.step ?? "Starting…")
                    : !v
                      ? "Add a video first."
                      : !canListen
                        ? capSource === "video"
                          ? "This video has no sound. Listen to the external audio instead."
                          : "Add external audio (step 3) first."
                        : ""}
                </span>
              </div>
              {errors.captions && <ErrorLine>{errors.captions}</ErrorLine>}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Slider
                label="Size"
                value={s.caption_size}
                min={40}
                max={160}
                step={2}
                shown={`${s.caption_size}`}
                onChange={(caption_size) => patchSettings({ caption_size })}
              />
              <Slider
                label="Position"
                value={s.caption_y}
                min={0.05}
                max={0.95}
                step={0.01}
                shown={`${Math.round(s.caption_y * 100)}% down`}
                onChange={(caption_y) => patchSettings({ caption_y })}
              />
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold">Colour</span>
                <input
                  type="color"
                  value={s.caption_color}
                  onChange={(e) =>
                    patchSettings({
                      caption_color: e.target.value.toUpperCase(),
                    })
                  }
                  className="h-8 w-16 cursor-pointer rounded bg-transparent"
                />
              </label>
            </div>

            <div className="mt-4 space-y-2">
              {project.captions.map((c, i) => (
                <div
                  key={i}
                  className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${t >= c.start && t < c.end ? "bg-brand/15 ring-1 ring-brand/40" : "bg-white/5"}`}
                >
                  <input
                    value={c.text}
                    onChange={(e) => patchCue(i, { text: e.target.value })}
                    className="input min-w-40 flex-1 px-2 py-1 text-sm"
                  />
                  <TimeField
                    label="From"
                    value={c.start}
                    now={t}
                    onChange={(start) => patchCue(i, { start })}
                  />
                  <TimeField
                    label="to"
                    value={c.end}
                    now={t}
                    onChange={(end) => patchCue(i, { end })}
                  />
                  <button
                    onClick={() => setT(c.start)}
                    className="rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted hover:text-white"
                    title="Show this caption in the preview"
                  >
                    Go
                  </button>
                  <button
                    onClick={() =>
                      update((p) => ({
                        ...p,
                        captions: p.captions.filter((_, k) => k !== i),
                      }))
                    }
                    className="rounded p-1 text-muted hover:text-red-300"
                    title="Delete caption"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() =>
                  update((p) => ({
                    ...p,
                    captions: [
                      ...p.captions,
                      {
                        text: "",
                        start: r1(t),
                        end: r1(Math.min(t + 1.5, length || t + 1.5)),
                      },
                    ].sort((a, b) => a.start - b.start),
                  }))
                }
                className="btn-ghost border-dashed"
              >
                <Plus className="size-4" /> Add caption at {t.toFixed(1)}s
              </button>
              {project.captions.length > 0 && (
                <button
                  onClick={() =>
                    confirm("Delete all captions?") && patch({ captions: [] })
                  }
                  className="btn-ghost text-muted"
                >
                  <Trash2 className="size-4" /> Clear all
                </button>
              )}
            </div>
          </Section>

          <Section n={5} title="Text on video">
            {project.texts.length === 0 && (
              <p className="mb-3 text-sm text-muted">
                Add titles, labels or any words, each shown for its own time and
                placed anywhere on the screen.
              </p>
            )}
            <div className="space-y-3">
              {project.texts.map((it, i) => (
                <div
                  key={it.id}
                  className={`space-y-3 rounded-xl bg-ink p-3 ring-1 ${t >= it.start && t < it.end ? "ring-brand/50" : "ring-line"}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-2 text-xs font-bold text-muted">
                      {i + 1}
                    </span>
                    <textarea
                      value={it.text}
                      rows={2}
                      onChange={(e) =>
                        patchText(it.id, { text: e.target.value })
                      }
                      placeholder="Your text (emoji work too)"
                      className="input flex-1 resize-y"
                    />
                    <button
                      onClick={() =>
                        update((p) => ({
                          ...p,
                          texts: p.texts.filter((x) => x.id !== it.id),
                        }))
                      }
                      className="rounded p-1.5 text-muted hover:text-red-300"
                      title="Delete text"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <TimeField
                      label="Show from"
                      value={it.start}
                      now={t}
                      onChange={(start) => patchText(it.id, { start })}
                    />
                    <TimeField
                      label="to"
                      value={it.end}
                      now={t}
                      onChange={(end) => patchText(it.id, { end })}
                    />
                    <button
                      onClick={() =>
                        patchText(it.id, { start: 0, end: r1(length) })
                      }
                      className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-semibold text-muted hover:text-white"
                    >
                      Whole video
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Slider
                      label="Across"
                      value={it.x}
                      min={0.05}
                      max={0.95}
                      step={0.01}
                      shown={`${Math.round(it.x * 100)}%`}
                      onChange={(x) => patchText(it.id, { x })}
                    />
                    <Slider
                      label="Down"
                      value={it.y}
                      min={0.03}
                      max={0.97}
                      step={0.01}
                      shown={`${Math.round(it.y * 100)}%`}
                      onChange={(y) => patchText(it.id, { y })}
                    />
                    <Slider
                      label="Size"
                      value={it.size}
                      min={24}
                      max={200}
                      step={2}
                      shown={`${it.size}`}
                      onChange={(size) => patchText(it.id, { size })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                    <label className="flex items-center gap-2">
                      Colour
                      <input
                        type="color"
                        value={it.color}
                        onChange={(e) =>
                          patchText(it.id, {
                            color: e.target.value.toUpperCase(),
                          })
                        }
                        className="h-7 w-12 cursor-pointer rounded bg-transparent"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      Box behind
                      <Switch
                        on={it.box}
                        onChange={(box) => patchText(it.id, { box })}
                        label="Box behind the text"
                      />
                    </label>
                    {it.box && (
                      <label className="flex items-center gap-2">
                        Box colour
                        <input
                          type="color"
                          value={it.box_color}
                          onChange={(e) =>
                            patchText(it.id, {
                              box_color: e.target.value.toUpperCase(),
                            })
                          }
                          className="h-7 w-12 cursor-pointer rounded bg-transparent"
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                update((p) => ({
                  ...p,
                  texts: [...p.texts, newText(t, length)],
                }))
              }
              className="btn-ghost mt-3 w-full border-dashed"
            >
              <Type className="size-4" /> Add text at {t.toFixed(1)}s
            </button>
          </Section>

          <div className="card space-y-4 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-brand/15 text-xs font-bold text-sky ring-1 ring-brand/40">
                6
              </span>
              <h2 className="font-bold tracking-tight uppercase">
                Render video
              </h2>
            </div>
            {v ? (
              <p className="flex items-center gap-2 text-sm">
                <Clock className="size-4 text-muted" /> Video length:{" "}
                <b>{formatSeconds(length)}</b>
              </p>
            ) : (
              <p className="text-sm text-muted">
                To render, add a video (step 2).
              </p>
            )}
            <button
              onClick={generateVideo}
              disabled={!v || length < 0.5 || busyAny || !!render}
              className="btn-primary w-full py-3.5 text-base"
            >
              <Wand2 className="size-5" /> Render video
            </button>
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:w-[300px] lg:shrink-0">
          <div className="card p-4">
            <VideoPreview project={project} t={t} onTime={setT} />
          </div>
        </div>
      </div>

      {render && (
        <RenderDialog state={render} onClose={() => setRender(null)} />
      )}
    </div>
  );
}
