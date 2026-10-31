import {
  ClipboardCopy,
  Copy,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Job, waitForJob } from "../../api";
import FileButton from "../../components/FileButton";
import {
  type AiProject,
  type MediaFile,
  type SoundClip,
  type SoundIdea,
  type SoundOption,
  soundPlayed,
} from "./types";

const AUDIO = ".mp3,.wav,.m4a,audio/*";
const r2 = (v: number) => Math.round(v * 100) / 100;
const newId = () => Math.random().toString(36).slice(2, 10);
const ONE_SHOT = 4; // seconds of a long download to place for a one-off sound; trim picks the part
const creditOf = (o: SoundOption) =>
  `"${o.title}"${o.artist ? ` by ${o.artist}` : ""}, ${o.licence}, ${o.page}`;

type Props = {
  project: AiProject;
  t: number; // playhead
  total: number;
  picked: string | null;
  onPick: (id: string | null) => void;
  onSeek: (time: number) => void;
  onChange: (id: string, patch: Partial<SoundClip>) => void;
  onEdit: (id: string) => void; // open the sound's pop-up
  onProject: (fn: (p: AiProject) => AiProject) => void;
};

type Found = { source: "ai" | "keywords"; suggestions: SoundIdea[] };

/** The list under the sound effects track: add, adjust and remove sounds, and ask for ideas. */
export default function SoundPanel({
  project,
  t,
  total,
  picked,
  onPick,
  onSeek,
  onChange,
  onEdit,
  onProject,
}: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null); // the option or idea being fetched
  const [hearing, setHearing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fetched = useRef(new Map<string, MediaFile>());
  const listener = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => listener.current?.pause(), []);
  const credits = [
    ...new Set(
      project.sounds.map((c) => c.credit).filter((c) => c.includes("CC BY")),
    ),
  ];
  const synced = project.scenes.some((s) => s.captions !== null);

  function place(
    media: Pick<MediaFile, "file" | "name" | "url" | "duration">,
    start: number,
    length: number,
    volume = 0.7,
    extra: Partial<SoundClip> = {},
  ) {
    const at = r2(Math.min(start, Math.max(total - 0.1, 0)));
    const clip: SoundClip = {
      id: newId(),
      file: media.file,
      name: media.name,
      url: media.url,
      duration: media.duration,
      start: at,
      length: r2(Math.min(length, total - at)),
      volume,
      trim_start: 0,
      trim_end: 0,
      speed: 1,
      credit: "",
      ...extra,
    };
    onProject((p) => ({ ...p, sounds: [...p.sounds, clip] }));
    onPick(clip.id);
  }

  async function upload(key: string, file: File, idea?: SoundIdea) {
    setUploading(key);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const media = await api<MediaFile>(
        `/api/aivideo/projects/${project.id}/sounds`,
        { method: "POST", body },
      );
      if (idea) {
        place(media, idea.start, idea.ambient ? idea.length : media.duration);
        drop(idea);
      } else place(media, t, media.duration);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function download(o: SoundOption) {
    const have = fetched.current.get(o.url);
    if (have) return have;
    const media = await api<MediaFile>(
      `/api/aivideo/projects/${project.id}/fetch-sound`,
      { method: "POST", json: { url: o.url, title: o.title } },
    );
    fetched.current.set(o.url, media);
    return media;
  }

  /** Plays a sound, or stops it if it's the one playing. `key` tells the sounds apart. */
  async function listen(key: string, source: () => Promise<string>) {
    listener.current?.pause();
    if (hearing === key) return setHearing(null);
    setHearing(null);
    setBusy(key);
    setError("");
    try {
      const el = new Audio(await source());
      el.onended = () => setHearing(null);
      listener.current = el;
      await el.play();
      setHearing(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save(o: SoundOption) {
    setBusy(o.url);
    setError("");
    try {
      const media = await download(o);
      const link = document.createElement("a");
      link.href = media.url;
      link.download = `${o.title}.mp3`;
      link.click();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function take(idea: SoundIdea, o: SoundOption) {
    setBusy(o.url);
    setError("");
    try {
      const media = await download(o);
      const length = idea.ambient
        ? idea.length
        : Math.min(media.duration, Math.max(idea.length, ONE_SHOT));
      place(media, idea.start, length, 0.7, { credit: creditOf(o) });
      drop(idea);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function searchAgain(idea: SoundIdea) {
    setBusy(idea.sound);
    setError("");
    try {
      const options = await api<SoundOption[]>(
        `/api/aivideo/sound-options?name=${encodeURIComponent(idea.sound)}`,
      );
      setFound(
        (f) =>
          f && {
            ...f,
            suggestions: f.suggestions.map((x) =>
              x === idea ? { ...x, options } : x,
            ),
          },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    setAsking(true);
    setError("");
    setFound(null);
    setChoice({});
    try {
      const job = await api<Job<Found>>(
        `/api/aivideo/projects/${project.id}/suggest-sounds`,
        { method: "POST", json: project },
      );
      setFound(await waitForJob(job, (j) => setStep(j.step)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
      setStep("");
    }
  }

  const drop = (idea: SoundIdea) =>
    setFound(
      (f) =>
        f && {
          ...f,
          suggestions: f.suggestions.filter((x) => x !== idea),
        },
    );

  function addIdea(idea: SoundIdea) {
    const media = project.sounds.find((c) => c.file === idea.file);
    if (!media) return;
    place(media, idea.start, idea.length, media.volume);
    drop(idea);
  }

  return (
    <div className="mt-5 rounded-xl bg-ink p-4 ring-1 ring-line">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold">Sound effects</p>
        <button onClick={ask} disabled={asking} className="btn-ghost">
          {asking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}{" "}
          Suggest places
        </button>
        <FileButton
          accept={AUDIO}
          busy={uploading === "add"}
          label="Add sound"
          onFile={(f) => upload("add", f)}
        />
      </div>
      {asking && (
        <p className="mb-3 text-xs text-muted">{step || "Starting…"}</p>
      )}
      {error && (
        <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {found && (
        <div className="mb-3 rounded-lg bg-white/5 p-3">
          <div className="mb-2 flex items-start gap-2">
            <p className="flex-1 text-xs text-muted">
              {found.source === "ai"
                ? "Suggested by AI from your script."
                : "The AI couldn't be reached, so these come from matching words in your script."}
              {!synced &&
                " Run Auto-sync first so they land on the spoken words."}
            </p>
            <button
              onClick={() => setFound(null)}
              className="rounded p-0.5 text-muted hover:text-white"
              title="Close suggestions"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {!found.suggestions.length && (
            <p className="text-sm text-muted">
              No new places to suggest for this script.
            </p>
          )}
          <div className="space-y-2">
            {found.suggestions.map((idea, k) => {
              const key = `${idea.sound}-${idea.start}`;
              const options = idea.options ?? [];
              const option = options[choice[key] ?? 0];
              const owned = project.sounds.find((c) => c.file === idea.file);
              const sound = option?.url ?? owned?.url;
              return (
                <div
                  key={key}
                  className="border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        sound &&
                        listen(sound, async () =>
                          option ? (await download(option)).url : sound,
                        )
                      }
                      disabled={!sound || busy === sound}
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110 disabled:opacity-40"
                      title={
                        sound ? "Listen to this sound" : "No sound to play"
                      }
                      aria-label={`Play ${idea.sound}`}
                    >
                      {sound && busy === sound ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : hearing === sound ? (
                        <Square className="size-3" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="text-sm font-semibold break-words">
                        {idea.sound}{" "}
                        <button
                          onClick={() => onSeek(idea.start)}
                          className="font-mono text-xs font-normal text-muted underline decoration-dotted hover:text-white"
                          title="Jump to this place in the video"
                        >
                          {idea.start.toFixed(1)}s
                          {idea.ambient &&
                            `–${(idea.start + idea.length).toFixed(1)}s`}
                        </button>
                      </p>
                      {idea.reason && (
                        <p className="text-xs break-words text-muted">
                          {idea.reason}
                        </p>
                      )}
                    </div>
                    {idea.file && (
                      <button
                        onClick={() => addIdea(idea)}
                        className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        <Plus className="size-3.5" /> Add to timeline
                      </button>
                    )}
                    <button
                      onClick={() => drop(idea)}
                      className="shrink-0 rounded p-1 text-muted hover:text-red-300"
                      title="Dismiss"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  {!idea.file && (
                    <div className="mt-1.5 space-y-1.5 pl-10">
                      {option ? (
                        <>
                          {options.length > 1 && (
                            <select
                              value={choice[key] ?? 0}
                              onChange={(e) => {
                                listener.current?.pause();
                                setHearing(null);
                                setChoice((c) => ({
                                  ...c,
                                  [key]: Number(e.target.value),
                                }));
                              }}
                              className="input w-full py-1.5 text-xs"
                              aria-label={`Free sound for ${idea.sound}`}
                            >
                              {options.map((o, i) => (
                                <option key={o.url} value={i}>
                                  {o.title}
                                </option>
                              ))}
                            </select>
                          )}
                          <div className="text-xs break-words">
                            <p className="font-semibold">{option.title}</p>
                            {option.about && (
                              <p className="text-muted">{option.about}</p>
                            )}
                            <p className="text-[11px] text-muted">
                              {option.duration.toFixed(1)}s · {option.licence}
                              {option.artist && ` · ${option.artist}`}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted">
                          No free sound found for this.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {option ? (
                          <>
                            <button
                              onClick={() => save(option)}
                              disabled={busy === option.url}
                              className="btn-ghost px-3 py-1.5 text-xs"
                              title="Save this sound to your computer"
                            >
                              <Download className="size-3.5" /> Download
                            </button>
                            <button
                              onClick={() => take(idea, option)}
                              disabled={busy === option.url}
                              className="btn-ghost px-3 py-1.5 text-xs"
                            >
                              <Plus className="size-3.5" /> Add to timeline
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => searchAgain(idea)}
                            disabled={busy === idea.sound}
                            className="btn-ghost px-3 py-1.5 text-xs"
                          >
                            {busy === idea.sound ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3.5" />
                            )}{" "}
                            Search again
                          </button>
                        )}
                        <FileButton
                          accept={AUDIO}
                          busy={uploading === `idea${k}`}
                          label="Upload my own"
                          onFile={(f) => upload(`idea${k}`, f, idea)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {project.sounds.length === 0 ? (
        <p className="text-xs text-muted">
          Add a knock, rain or any other sound. It lands at the playhead, then
          drag it along the track.
        </p>
      ) : (
        <div className="space-y-1.5">
          {project.sounds.map((c) => (
            <div
              key={c.id}
              onClick={() => onPick(c.id)}
              className={`flex flex-wrap items-center gap-2 rounded-lg p-1.5 ${picked === c.id ? "bg-emerald-400/10 ring-1 ring-emerald-400/40" : ""}`}
            >
              <button
                onClick={() => onSeek(c.start)}
                className="shrink-0 rounded p-1 text-muted hover:text-white"
                title="Jump here"
              >
                <Play className="size-3" />
              </button>
              <span className="min-w-0 flex-1 basis-32 truncate text-sm">
                {c.name}
                {c.length > soundPlayed(c) + 0.01 && (
                  <span className="ml-1.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
                    loops
                  </span>
                )}
              </span>
              <input
                type="number"
                step={0.1}
                min={0}
                value={c.start}
                onChange={(e) =>
                  onChange(c.id, {
                    start: Math.min(
                      Math.max(Number(e.target.value), 0),
                      total - 0.1,
                    ),
                  })
                }
                className="input w-20 py-1.5 text-xs"
                title="Starts at (seconds)"
              />
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={c.length}
                onChange={(e) =>
                  onChange(c.id, {
                    length: Math.max(Number(e.target.value), 0.1),
                  })
                }
                className="input w-20 py-1.5 text-xs"
                title="Plays for (seconds)"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={c.volume}
                onChange={(e) =>
                  onChange(c.id, { volume: Number(e.target.value) })
                }
                className="w-20 accent-brand"
                title={`Volume ${Math.round(c.volume * 100)}%`}
                aria-label={`Volume of ${c.name}`}
              />
              <button
                onClick={() => onEdit(c.id)}
                className="btn-ghost px-2.5 py-1 text-xs"
                title="Trim and edit this sound"
              >
                <Scissors className="size-3.5" /> Trim
              </button>
              <button
                onClick={() =>
                  place(c, t, c.length, c.volume, {
                    trim_start: c.trim_start,
                    trim_end: c.trim_end,
                    speed: c.speed,
                    credit: c.credit,
                  })
                }
                className="shrink-0 rounded p-1 text-muted hover:text-white"
                title="Use again at the playhead"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                onClick={() =>
                  onProject((p) => ({
                    ...p,
                    sounds: p.sounds.filter((x) => x.id !== c.id),
                  }))
                }
                className="shrink-0 rounded p-1 text-muted hover:text-red-300"
                title="Remove from the timeline"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-muted">
            Boxes are the start and how long it plays, in seconds. Longer than
            the sound itself and it loops. Click a sound on the track to trim
            it.
          </p>
          {credits.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <p className="min-w-0 flex-1 basis-52 text-[11px] text-muted">
                Free library sounds with a CC BY licence must be credited. Paste
                the credits into your video description.
              </p>
              <button
                onClick={() => {
                  navigator.clipboard
                    .writeText(credits.join("\n"))
                    .then(() => setCopied(true))
                    .catch(() => setError("Couldn't copy the credits."));
                }}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <ClipboardCopy className="size-3.5" />{" "}
                {copied ? "Copied" : "Copy credits"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
