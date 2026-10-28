import { AlertTriangle, ArrowLeft, Check, Clock, Info, Loader2, Plus, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Clip, formatSeconds, type Job, type Video, waitForJob } from "../../api";
import RenderDialog, { type RenderState } from "../../components/RenderDialog";
import Section from "../../components/Section";
import { playbackOrder, slotSeconds } from "./layout";
import PhonePreview from "./PhonePreview";
import PlaybackOrder from "./PlaybackOrder";
import SettingsPanel from "./SettingsPanel";
import SlotCard, { type SlotStatus } from "./SlotCard";
import TitleEditor from "./TitleEditor";
import { MAX_SLOTS, MIN_SLOTS, newSlot, type Project, type Slot } from "./types";

export default function RankingEditor() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [status, setStatus] = useState<Record<string, SlotStatus>>({});
  const [previewStep, setPreviewStep] = useState(0);
  const [render, setRender] = useState<RenderState | null>(null);

  const latest = useRef<Project | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    api<Project>(`/api/ranking/projects/${id}`)
      .then((p) => {
        latest.current = p;
        setProject(p);
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  // Autosave: debounce edits, and flush on leave.
  useEffect(() => {
    if (!project || !dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await api(`/api/ranking/projects/${project.id}`, { method: "PUT", json: project });
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
        fetch(`/api/ranking/projects/${p.id}`, {
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

  const update = useCallback((fn: (p: Project) => Project) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      latest.current = next;
      dirty.current = true;
      return next;
    });
  }, []);

  const patch = (p: Partial<Project>) => update((prev) => ({ ...prev, ...p }));
  const patchSlot = (slotId: string, p: Partial<Slot>) =>
    update((prev) => ({ ...prev, slots: prev.slots.map((s) => (s.id === slotId ? { ...s, ...p } : s)) }));
  const setSlotStatus = (slotId: string, s: SlotStatus) => setStatus((prev) => ({ ...prev, [slotId]: s }));

  async function download(slotId: string, url: string) {
    setSlotStatus(slotId, { busy: true, step: "Starting download…", progress: 0 });
    try {
      const job = await api<Job<Clip>>("/api/clips/download", { method: "POST", json: { url } });
      const clip = await waitForJob(job, (j) => setSlotStatus(slotId, { busy: true, step: j.step, progress: j.progress }));
      patchSlot(slotId, { clip, url });
      setSlotStatus(slotId, { busy: false });
    } catch (e) {
      setSlotStatus(slotId, { busy: false, error: (e as Error).message });
    }
  }

  async function upload(slotId: string, file: File) {
    setSlotStatus(slotId, { busy: true, step: `Uploading ${file.name}…`, progress: 0.5 });
    try {
      const body = new FormData();
      body.append("file", file);
      const clip = await api<Clip>("/api/clips/upload", { method: "POST", body });
      patchSlot(slotId, { clip, url: "" });
      setSlotStatus(slotId, { busy: false });
    } catch (e) {
      setSlotStatus(slotId, { busy: false, error: (e as Error).message });
    }
  }

  function addSlot() {
    update((p) => {
      if (p.slots.length >= MAX_SLOTS) return p;
      const n = p.slots.length + 1;
      return { ...p, slots: [...p.slots, newSlot()], order: p.custom_order ? [n, ...playbackOrder(p)] : p.order };
    });
  }

  function removeSlot(index: number) {
    const rank = index + 1;
    update((p) => {
      if (p.slots.length <= MIN_SLOTS) return p;
      const order = playbackOrder(p)
        .filter((r) => r !== rank)
        .map((r) => (r > rank ? r - 1 : r));
      return { ...p, slots: p.slots.filter((_, i) => i !== index), order };
    });
  }

  function moveSlot(index: number, dir: -1 | 1) {
    update((p) => {
      const j = index + dir;
      if (j < 0 || j >= p.slots.length) return p;
      const slots = [...p.slots];
      [slots[index], slots[j]] = [slots[j], slots[index]];
      return { ...p, slots };
    });
  }

  async function generate() {
    if (!project) return;
    setRender({ job: null });
    try {
      const job = await api<Job<Video>>(`/api/ranking/projects/${project.id}/render`, { method: "POST", json: project });
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
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-red-300">{loadError}</p>
        <Link to="/ranking" className="btn-ghost mt-4">
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

  const n = project.slots.length;
  const s = project.settings;
  const order = playbackOrder(project);
  const total = project.slots.reduce((sum, slot) => sum + slotSeconds(slot, s.max_seconds), 0);
  const missing = project.slots.map((slot, i) => (slot.clip || slot.url.trim() ? 0 : i + 1)).filter(Boolean);
  const busy = Object.values(status).some((st) => st.busy);
  const step = Math.min(previewStep, n - 1);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to="/ranking" className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-white" title="All ranking projects">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-sky uppercase">Ranking Video</p>
          <h1 className="text-xl font-black tracking-tight break-words sm:text-2xl">{project.title.split("\n").join(" ") || "Untitled ranking"}</h1>
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
          {saveState === "error" && <span className="text-red-300">Couldn't save. Is the app still running?</span>}
        </span>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <Section n={1} title="Title">
            <TitleEditor
              title={project.title}
              highlights={project.highlights}
              color={s.keyword_color}
              onTitle={(title) => patch({ title })}
              onHighlights={(highlights) => patch({ highlights })}
              onColor={(keyword_color) => patch({ settings: { ...s, keyword_color } })}
            />
          </Section>

          <Section
            n={2}
            title="Clips"
            aside={
              <span className={`text-xs font-semibold ${n >= 5 && n <= 7 ? "text-emerald-400" : "text-amber"}`}>
                {n} clips · 5–7 perform best
              </span>
            }
          >
            <div className="space-y-3">
              {project.slots.map((slot, i) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  rank={i + 1}
                  count={n}
                  canRemove={n > MIN_SLOTS}
                  status={status[slot.id]}
                  onChange={(p) => patchSlot(slot.id, p)}
                  onDownload={(url) => download(slot.id, url)}
                  onUpload={(f) => upload(slot.id, f)}
                  onRemove={() => removeSlot(i)}
                  onMove={(dir) => moveSlot(i, dir)}
                />
              ))}
            </div>
            <button onClick={addSlot} disabled={n >= MAX_SLOTS} className="btn-ghost mt-4 w-full border-dashed">
              <Plus className="size-4" /> Add rank {n < MAX_SLOTS ? `#${n + 1}` : "(max 10)"}
            </button>
          </Section>

          <Section n={3} title="Playback order">
            <PlaybackOrder project={project} onChange={patch} />
          </Section>

          <Section n={4} title="Style & timing">
            <SettingsPanel s={s} onChange={(p) => patch({ settings: { ...s, ...p } })} />
          </Section>

          <div className="card space-y-4 p-4 sm:p-6">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-muted" />
              <span>
                Estimated length: <b>{formatSeconds(total)}</b>
              </span>
            </div>
            {total > 180 ? (
              <p className="flex gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Longer than 3 minutes, YouTube's Shorts limit. Lower "max seconds per clip" or remove clips.
              </p>
            ) : total > 60 ? (
              <p className="flex gap-2 rounded-xl bg-amber/10 px-4 py-3 text-sm text-amber">
                <Info className="mt-0.5 size-4 shrink-0" /> Over 60 seconds. YouTube Shorts allows up to 3 minutes, but ranking Shorts usually do best under a minute.
              </p>
            ) : null}
            {missing.length > 0 && (
              <p className="text-sm text-muted">Add a clip to rank {missing.map((r) => `#${r}`).join(", ")} to generate.</p>
            )}
            <button onClick={generate} disabled={missing.length > 0 || busy || !!render} className="btn-primary w-full py-3.5 text-base">
              <Wand2 className="size-5" /> Generate Video
            </button>
          </div>
        </div>

        <aside className="mx-auto shrink-0 lg:sticky lg:top-8 lg:w-[320px]">
          <PhonePreview project={project} step={step} />
          <div className="mt-4">
            <p className="mb-2 text-center text-xs text-muted">Preview moment: click a step</p>
            <div className="flex flex-wrap justify-center gap-1">
              {order.map((r, i) => (
                <button
                  key={r}
                  onClick={() => setPreviewStep(i)}
                  className={`rounded-md px-2 py-1 text-xs font-bold transition ${i === step ? "bg-brand text-white" : "bg-white/5 text-muted hover:text-white"}`}
                >
                  #{r}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {render && <RenderDialog state={render} onClose={() => setRender(null)} />}
    </div>
  );
}
