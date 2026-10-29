import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  FileText,
  Info,
  ListOrdered,
  Loader2,
  Music,
  Plus,
  Upload,
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
import RenderDialog, { type RenderState } from "../../components/RenderDialog";
import Section from "../../components/Section";
import Switch from "../../components/Switch";
import FootagePanel from "./FootagePanel";
import PreviewPanel from "./PreviewPanel";
import SceneRow from "./SceneRow";
import TitleColors from "./TitleColors";
import {
  type AiProject,
  type AiSettings,
  type Cue,
  type Footage,
  isBlank,
  type MediaFile,
  newScene,
  resolveTimings,
  type Scene,
} from "./types";

const SAMPLE = `| Time | Voiceover | On screen |
|---|---|---|
| 0–3s | Ranking the smallest countries in the world. | Spinning globe zooming in, big text "Smallest countries 🌍" |
| 3–11s | #5 San Marino: 61 km², founded in 301 AD | Hilltop castle in the clouds, label "61 km²" |`;

function FileButton({
  accept,
  busy,
  label,
  onFile,
}: {
  accept: string;
  busy: boolean;
  label: string;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="btn-ghost"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}{" "}
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

function Toggle({
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

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  );
}

export default function AiVideoEditor() {
  const { id } = useParams();
  const [project, setProject] = useState<AiProject | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [tab, setTab] = useState<"paste" | "scenes">("paste");
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [footageBusy, setFootageBusy] = useState<Set<string>>(new Set());
  const [footageJob, setFootageJob] = useState<Job | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);
  const [syncJob, setSyncJob] = useState<Job | null>(null);
  const [syncing, setSyncing] = useState(false);

  const latest = useRef<AiProject | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    api<AiProject>(`/api/aivideo/projects/${id}`)
      .then((p) => {
        latest.current = p;
        setProject(p);
        if (p.scenes.length) setTab("scenes");
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  // Autosave: debounce edits, and flush on leave (same approach as the ranking editor).
  useEffect(() => {
    if (!project || !dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await api(`/api/aivideo/projects/${project.id}`, {
          method: "PUT",
          json: project,
        });
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    const flush = () => {
      const p = latest.current;
      if (p && dirty.current) {
        fetch(`/api/aivideo/projects/${p.id}`, {
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

  const update = useCallback((fn: (p: AiProject) => AiProject) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next === prev) return prev;
      latest.current = next;
      dirty.current = true;
      return next;
    });
  }, []);

  const patch = (p: Partial<AiProject>) =>
    update((prev) => ({ ...prev, ...p }));
  const patchSettings = (s: Partial<AiSettings>) =>
    update((prev) => ({ ...prev, settings: { ...prev.settings, ...s } }));
  const patchScene = (sceneId: string, s: Partial<Scene>) =>
    update((prev) => ({
      ...prev,
      scenes: prev.scenes.map((x) => (x.id === sceneId ? { ...x, ...s } : x)),
    }));
  const setError = (key: string, msg: string) =>
    setErrors((e) => ({ ...e, [key]: msg }));
  const setBusy = (key: string, v: boolean) =>
    setUploading((u) => ({ ...u, [key]: v }));

  async function uploadAudio(kind: "voiceover" | "music", file: File) {
    setBusy(kind, true);
    setError(kind, "");
    try {
      const body = new FormData();
      body.append("file", file);
      const media = await api<MediaFile>(
        `/api/aivideo/projects/${id}/${kind}`,
        { method: "POST", body },
      );
      patch({ [kind]: media });
    } catch (e) {
      setError(kind, (e as Error).message);
    } finally {
      setBusy(kind, false);
    }
  }

  async function uploadScene(sceneId: string, file: File) {
    setBusy(sceneId, true);
    setError("scenes", "");
    try {
      const body = new FormData();
      body.append("file", file);
      const f = await api<Footage>(`/api/aivideo/projects/${id}/scene-upload`, {
        method: "POST",
        body,
      });
      patchScene(sceneId, { upload: f, footage: f });
    } catch (e) {
      setError("scenes", (e as Error).message);
    } finally {
      setBusy(sceneId, false);
    }
  }

  async function parseScript(auto = false) {
    if (!project) return;
    setError("parse", "");
    const hasContent = project.scenes.some((x) => !isBlank(x));
    if (auto && hasContent) return;
    if (
      !auto &&
      hasContent &&
      !confirm("Replace the current scenes with the ones from this table?")
    )
      return;
    setBusy("parse", true);
    try {
      const { scenes } = await api<{ scenes: Scene[] }>("/api/aivideo/parse", {
        method: "POST",
        json: { text: project.script_text },
      });
      patch({ scenes });
      setTab("scenes");
    } catch (e) {
      if (!auto) setError("parse", (e as Error).message);
    } finally {
      setBusy("parse", false);
    }
  }

  // Pasting a script into a project with no real scenes yet turns it into scenes straight away.
  const scriptText = project?.script_text ?? "";
  useEffect(() => {
    if (!scriptText.trim()) return;
    const t = setTimeout(() => parseScript(true), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptText]);

  function applyFootage(map: Record<string, Footage> | null) {
    if (!map) return;
    update((p) => {
      let changed = false;
      const scenes = p.scenes.map((s) => {
        const f = map[s.id];
        if (!f || f.thumb === s.footage?.thumb) return s;
        changed = true;
        return { ...s, footage: f };
      });
      return changed ? { ...p, scenes } : p;
    });
  }

  async function generateFootage(sceneIds: string[]) {
    if (!latest.current) return;
    setError("footage", "");
    setFootageBusy(new Set(sceneIds));
    try {
      const job = await api<Job<Record<string, Footage>>>(
        `/api/aivideo/projects/${id}/footage`,
        {
          method: "POST",
          json: { project: latest.current, scene_ids: sceneIds },
        },
      );
      const result = await waitForJob(job, (j) => {
        setFootageJob(j);
        applyFootage(j.result);
        if (j.result)
          setFootageBusy(
            new Set(sceneIds.filter((s) => !(s in (j.result ?? {})))),
          );
      });
      applyFootage(result);
    } catch (e) {
      setError("footage", (e as Error).message);
    } finally {
      setFootageBusy(new Set());
      setFootageJob(null);
    }
  }

  async function autoSync() {
    if (!latest.current) return;
    setSyncing(true);
    setError("sync", "");
    try {
      type Synced = {
        scenes: { id: string; start: number; end: number; captions: Cue[] }[];
      };
      const job = await api<Job<Synced>>(`/api/aivideo/projects/${id}/sync`, {
        method: "POST",
        json: latest.current,
      });
      const res = await waitForJob(job, setSyncJob);
      const byId = new Map(res.scenes.map((x) => [x.id, x]));
      update((p) => ({
        ...p,
        scenes: p.scenes.map((sc) => {
          const r = byId.get(sc.id);
          return r
            ? {
                ...sc,
                start: r.start,
                end: r.end,
                captions: r.captions.length ? r.captions : null,
              }
            : sc;
        }),
      }));
    } catch (e) {
      setError("sync", (e as Error).message);
    } finally {
      setSyncing(false);
      setSyncJob(null);
    }
  }

  async function generateVideo() {
    if (!latest.current) return;
    setRender({ job: null });
    try {
      const job = await api<
        Job<Video & { scene_footage: Record<string, Footage> }>
      >(`/api/aivideo/projects/${id}/render`, {
        method: "POST",
        json: latest.current,
      });
      dirty.current = false;
      const video = await waitForJob(job, (j) => setRender({ job: j }));
      applyFootage(video.scene_footage);
      setRender({ job: null, video });
      patch({ last_video_id: video.id });
    } catch (e) {
      setRender({ job: null, error: (e as Error).message });
    }
  }

  function moveScene(index: number, dir: -1 | 1) {
    update((p) => {
      const j = index + dir;
      if (j < 0 || j >= p.scenes.length) return p;
      const scenes = [...p.scenes];
      [scenes[index], scenes[j]] = [scenes[j], scenes[index]];
      return { ...p, scenes };
    });
  }

  if (loadError)
    return (
      <div className="p-10">
        <ErrorLine>{loadError}</ErrorLine>
        <Link to="/aivideo" className="btn-ghost mt-4">
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
  const audioLen = project.voiceover?.duration ?? 0;
  const scriptLen = Math.max(0, ...project.scenes.map((x) => x.end ?? 0));
  const timings = project.scenes.length
    ? resolveTimings(
        project.scenes,
        audioLen || scriptLen || project.scenes.length * 5,
      )
    : [];
  const noScenes = project.scenes.every(isBlank);
  const blockers = [
    !project.voiceover && "upload a voiceover (step 2)",
    noScenes &&
      (project.script_text.trim()
        ? 'click "Parse into scenes" (step 3)'
        : "add your script (step 3)"),
  ].filter(Boolean);
  const busyAny =
    Object.values(uploading).some(Boolean) || footageBusy.size > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/aivideo"
          className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-white"
          title="All AI video projects"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-sky uppercase">
            AI Video Generator
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

      <div className="space-y-5">
        <Section n={1} title="Title">
          <input
            value={project.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Type your video title, e.g. Smallest Countries In The World"
            className="input font-title text-lg tracking-wide placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:italic"
          />
          <p className="mt-2 text-xs text-muted">
            Shown in a bold banner at the top for the whole video.
          </p>
          <TitleColors
            title={project.title}
            color={project.title_color ?? "#FFFFFF"}
            highlights={project.title_highlights ?? {}}
            onColor={(title_color) => patch({ title_color })}
            onHighlights={(title_highlights) => patch({ title_highlights })}
          />
        </Section>

        <Section n={2} title="Voiceover">
          <div className="flex flex-wrap items-center gap-3">
            <FileButton
              accept=".mp3,.wav,.m4a,audio/*"
              busy={!!uploading.voiceover}
              label={
                project.voiceover
                  ? "Replace voiceover"
                  : "Upload voiceover (MP3/WAV)"
              }
              onFile={(f) => uploadAudio("voiceover", f)}
            />
            {project.voiceover && (
              <span className="inline-flex items-center gap-2 text-sm">
                <Clock className="size-4 text-muted" /> {project.voiceover.name}{" "}
                · <b>{formatSeconds(project.voiceover.duration)}</b>
              </span>
            )}
          </div>
          {project.voiceover && (
            <audio
              src={project.voiceover.url}
              controls
              className="mt-4 w-full"
            />
          )}
          {errors.voiceover && <ErrorLine>{errors.voiceover}</ErrorLine>}
          <p className="mt-2 text-xs text-muted">
            The voiceover is the master track: the video is exactly as long as
            this audio.
          </p>
        </Section>

        <Section
          n={3}
          title="Script"
          aside={
            <div className="flex rounded-full bg-ink p-1 ring-1 ring-line">
              {(
                [
                  ["paste", "Paste table", FileText],
                  [
                    "scenes",
                    `Scene editor (${project.scenes.length})`,
                    ListOrdered,
                  ],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${tab === key ? "bg-brand text-white" : "text-muted hover:text-white"}`}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          }
        >
          {tab === "paste" ? (
            <div>
              <textarea
                value={project.script_text}
                onChange={(e) => patch({ script_text: e.target.value })}
                rows={10}
                placeholder={SAMPLE}
                className="input resize-y font-mono text-xs leading-5"
              />
              <p className="mt-2 text-xs text-muted">
                Columns: <b>Time | Voiceover | On screen</b>, as a Markdown
                table or copied straight from a doc or spreadsheet. Quoted text
                in "On screen" becomes the big label; the rest is the footage
                prompt. "#5 Name:" at the start of a voiceover sets the rank.
              </p>
              {errors.parse && <ErrorLine>{errors.parse}</ErrorLine>}
              <button
                onClick={() => parseScript()}
                disabled={!project.script_text.trim() || !!uploading.parse}
                className="btn-primary mt-4"
              >
                {uploading.parse ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ListOrdered className="size-4" />
                )}{" "}
                Parse into scenes
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-3 rounded-xl bg-ink px-4 py-3 ring-1 ring-line">
                <p className="text-sm font-semibold">Whole video</p>
                <p className="text-xs text-muted">
                  Turn something off here to remove it from every scene. When
                  it's on, each scene can still hide it with its own switch.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["captions", "Captions"],
                      ["labels", "On-screen labels"],
                      ["ranking", "Ranking list"],
                    ] as const
                  ).map(([key, name]) => (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm"
                    >
                      <span>
                        {name}
                        <span className="block text-[11px] text-muted">
                          {s[key] !== false ? "On" : "Off in every scene"}
                        </span>
                      </span>
                      <Switch
                        on={s[key] !== false}
                        onChange={(v) => patchSettings({ [key]: v })}
                        label={`${name} in this video`}
                      />
                    </label>
                  ))}
                </div>
              </div>
              {!project.voiceover && project.scenes.length > 0 && (
                <p className="mb-3 text-xs text-muted">
                  Times shown use the script; they'll adjust to the voiceover
                  length once you upload it.
                </p>
              )}
              <div className="space-y-3">
                {project.scenes.map((scene, i) => (
                  <SceneRow
                    key={scene.id}
                    scene={scene}
                    index={i}
                    count={project.scenes.length}
                    timing={timings[i] ?? null}
                    uploading={!!uploading[scene.id]}
                    rankingOn={s.ranking}
                    labelsOn={s.labels !== false}
                    captionsOn={s.captions}
                    onChange={(p) => patchScene(scene.id, p)}
                    onRemove={() =>
                      update((pr) => ({
                        ...pr,
                        scenes: pr.scenes.filter((x) => x.id !== scene.id),
                      }))
                    }
                    onMove={(dir) => moveScene(i, dir)}
                    onUpload={(f) => uploadScene(scene.id, f)}
                  />
                ))}
              </div>
              {errors.scenes && <ErrorLine>{errors.scenes}</ErrorLine>}
              <button
                onClick={() =>
                  update((p) => ({ ...p, scenes: [...p.scenes, newScene()] }))
                }
                className="btn-ghost mt-4 w-full border-dashed"
              >
                <Plus className="size-4" /> Add scene
              </button>
            </div>
          )}
        </Section>

        <Section n={4} title="Footage · Step 1">
          <FootagePanel
            scenes={project.scenes}
            source={s.footage_source}
            busy={footageBusy}
            job={footageJob}
            error={errors.footage ?? ""}
            onSource={(footage_source) => patchSettings({ footage_source })}
            onGenerate={generateFootage}
          />
        </Section>

        <Section n={5} title="Music & effects">
          <div className="flex flex-wrap items-center gap-3">
            <FileButton
              accept=".mp3,.wav,.m4a,audio/*"
              busy={!!uploading.music}
              label={project.music ? "Replace music" : "Add background music"}
              onFile={(f) => uploadAudio("music", f)}
            />
            {project.music && (
              <span className="inline-flex items-center gap-2 text-sm">
                <Music className="size-4 shrink-0 text-muted" />{" "}
                <span className="min-w-0 break-all">{project.music.name}</span>
                <button
                  onClick={() => patch({ music: null })}
                  className="rounded p-1 text-muted hover:text-red-300"
                  title="Remove music"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
          {errors.music && <ErrorLine>{errors.music}</ErrorLine>}
          {project.music && (
            <div className="mt-4 max-w-sm">
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-semibold">Music volume</span>
                <span className="text-muted">
                  {Math.round(s.music_volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={s.music_volume}
                onChange={(e) =>
                  patchSettings({ music_volume: Number(e.target.value) })
                }
                className="w-full accent-brand"
              />
            </div>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Captions"
              hint="2–4 words at a time"
              on={s.captions}
              onChange={(captions) => patchSettings({ captions })}
            />
            <Toggle
              label="On-screen labels"
              hint="Big text box, whole video"
              on={s.labels !== false}
              onChange={(labels) => patchSettings({ labels })}
            />
            <Toggle
              label="Ranking list"
              hint="#1–#N on the side, whole video"
              on={s.ranking}
              onChange={(ranking) => patchSettings({ ranking })}
            />
            <Toggle
              label="Whoosh"
              hint="Sound on scene change"
              on={s.whoosh}
              onChange={(whoosh) => patchSettings({ whoosh })}
            />
          </div>
        </Section>

        <Section n={6} title="Preview & timeline">
          <PreviewPanel
            project={project}
            timings={timings}
            onScenes={(fn) => update((p) => ({ ...p, scenes: fn(p.scenes) }))}
            onSync={autoSync}
            syncJob={syncJob}
            syncing={syncing}
            syncError={errors.sync ?? ""}
          />
        </Section>

        <div className="card space-y-4 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-7 place-items-center rounded-full bg-brand/15 text-xs font-bold text-sky ring-1 ring-brand/40">
              7
            </span>
            <h2 className="font-bold tracking-tight uppercase">
              Render video · Step 2
            </h2>
          </div>
          {audioLen > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-muted" />
              <span>
                Video length: <b>{formatSeconds(audioLen)}</b> (matches the
                voiceover)
              </span>
            </div>
          )}
          {audioLen > 180 ? (
            <p className="flex gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Longer than 3
              minutes, YouTube's Shorts limit.
            </p>
          ) : audioLen > 60 ? (
            <p className="flex gap-2 rounded-xl bg-amber/10 px-4 py-3 text-sm text-amber">
              <Info className="mt-0.5 size-4 shrink-0" /> Over 60 seconds.
              Shorts allows up to 3 minutes, but shorter usually performs
              better.
            </p>
          ) : null}
          {blockers.length > 0 && (
            <p className="text-sm text-muted">
              To render, {blockers.join(" and ")}.
            </p>
          )}
          {project.scenes.some((x) => !x.footage) &&
            project.scenes.length > 0 && (
              <p className="text-xs text-muted">
                Scenes without footage get it automatically while rendering.
              </p>
            )}
          <button
            onClick={generateVideo}
            disabled={blockers.length > 0 || busyAny || syncing || !!render}
            className="btn-primary w-full py-3.5 text-base"
          >
            <Wand2 className="size-5" /> Render video
          </button>
        </div>
      </div>

      {render && (
        <RenderDialog state={render} onClose={() => setRender(null)} />
      )}
    </div>
  );
}
