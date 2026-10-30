import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clapperboard,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Job, type Video, waitForJob } from "../../api";
import RenderDialog, { type RenderState } from "../../components/RenderDialog";
import Section from "../../components/Section";
import Switch from "../../components/Switch";
import DrawingBoard from "./DrawingBoard";
import { makeLayers, type PartId, partContext, FW, FH } from "./figure";
import PuppetPreview from "./PuppetPreview";
import type { Action, Motion, PuppetProject } from "./types";

const newId = () => Math.random().toString(16).slice(2, 10);

export default function PuppetEditor() {
  const { id } = useParams();
  const [project, setProject] = useState<PuppetProject | null>(null);
  const [motions, setMotions] = useState<Motion[]>([]);
  const [frames, setFrames] = useState<number[][]>([]);
  const [fps, setFps] = useState(30);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [loadError, setLoadError] = useState("");
  const [render, setRender] = useState<RenderState | null>(null);

  const layers = useMemo(makeLayers, []);
  const latest = useRef<PuppetProject | null>(null);
  const dirty = useRef(false);
  const unsaved = useRef(new Set<PartId>());
  const uploading = useRef(false);
  const uploadTimer = useRef(0);

  useEffect(() => {
    Promise.all([
      api<PuppetProject>(`/api/puppet/projects/${id}`),
      api<Motion[]>("/api/puppet/motions"),
    ])
      .then(async ([p, m]) => {
        await Promise.all(
          Object.entries(p.parts).map(
            ([part, file]) =>
              new Promise<void>((done) => {
                const img = new Image();
                img.onload = () => {
                  partContext(layers[part as PartId]).drawImage(
                    img,
                    0,
                    0,
                    FW,
                    FH,
                  );
                  done();
                };
                img.onerror = () => done();
                img.src = `/media/puppet/${p.id}/${file}`;
              }),
          ),
        );
        latest.current = p;
        setProject(p);
        setMotions(m);
        setVersion((v) => v + 1);
      })
      .catch((e) => setLoadError(e.message));
  }, [id, layers]);

  const update = useCallback((patch: Partial<PuppetProject>) => {
    dirty.current = true;
    setProject((p) => {
      const next = p ? { ...p, ...patch } : p;
      latest.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!project || !dirty.current) return;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        await api(`/api/puppet/projects/${project.id}`, {
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

  // Body parts upload one at a time, so two can't overwrite each other's save on the server.
  const uploadParts = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    setSaveState("saving");
    try {
      while (unsaved.current.size) {
        const [part] = unsaved.current;
        unsaved.current.delete(part);
        const blob = await new Promise<Blob | null>((ok) =>
          layers[part].toBlob(ok, "image/png"),
        );
        if (!blob) continue;
        const form = new FormData();
        form.append("file", blob, `${part}.png`);
        const { parts } = await api<Pick<PuppetProject, "parts">>(
          `/api/puppet/projects/${id}/parts/${part}`,
          { method: "POST", body: form },
        );
        setProject((p) => {
          const next = p ? { ...p, parts } : p;
          latest.current = next;
          return next;
        });
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      uploading.current = false;
    }
  }, [id, layers]);

  const drew = useCallback(
    (parts: PartId[]) => {
      parts.forEach((p) => unsaved.current.add(p));
      setVersion((v) => v + 1);
      clearTimeout(uploadTimer.current);
      uploadTimer.current = window.setTimeout(uploadParts, 500);
    },
    [uploadParts],
  );

  useEffect(() => {
    const flush = () => {
      const p = latest.current;
      if (p && dirty.current) {
        fetch(`/api/puppet/projects/${p.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
          keepalive: true,
        });
      }
      if (unsaved.current.size) uploadParts();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [uploadParts]);

  // The poses come from the server, so the preview always matches the render.
  const actions = project?.actions;
  const startX = project?.start_x;
  useEffect(() => {
    if (!actions) return;
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ fps: number; frames: number[][] }>(
          `/api/puppet/projects/${id}/track`,
          { method: "POST", json: latest.current },
        );
        setFps(res.fps);
        setFrames(res.frames);
      } catch {
        /* the preview just keeps its last poses */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [actions, startX, id]);

  if (loadError)
    return (
      <p className="m-8 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {loadError}
      </p>
    );
  if (!project)
    return <Loader2 className="m-10 size-6 animate-spin text-sky" />;

  const list = project.actions;
  const setAction = (a: Action, patch: Partial<Action>) =>
    update({
      actions: list.map((x) => (x.id === a.id ? { ...x, ...patch } : x)),
    });
  const total = list.reduce((sum, a) => sum + a.seconds, 0);

  function addAction() {
    const m = motions.find((x) => x.id === "walk") ?? motions[0];
    update({
      actions: [
        ...list,
        { id: newId(), motion: m.id, seconds: m.seconds, to: null },
      ],
    });
  }

  function chooseMotion(a: Action, motion: string) {
    const m = motions.find((x) => x.id === motion);
    setAction(a, { motion, seconds: m?.seconds ?? a.seconds });
  }

  async function startRender() {
    setRender({ job: null });
    try {
      await uploadParts();
      const job = await api<Job<Video>>(`/api/puppet/projects/${id}/render`, {
        method: "POST",
        json: latest.current,
      });
      const video = await waitForJob(job, (j) => setRender({ job: j }));
      setRender({ job: null, video });
    } catch (e) {
      setRender({ job: null, error: (e as Error).message });
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/puppet"
          className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-white"
          title="All stories"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-sky uppercase">
            Story Puppets
          </p>
          <input
            value={project.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Untitled story"
            className="w-full bg-transparent text-xl font-black tracking-tight outline-none placeholder:text-muted/60 sm:text-2xl"
            aria-label="Story name"
          />
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
            <span className="inline-flex items-center gap-1.5 text-red-300">
              <AlertCircle className="size-3.5" /> Couldn&apos;t save. Is the
              app still running?
            </span>
          )}
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section n={1} title="Your character">
            <DrawingBoard
              layers={layers}
              drawn={Object.keys(project.parts).length > 0}
              onChange={drew}
            />
          </Section>

          <Section n={2} title="What happens">
            <div className="flex flex-col gap-3">
              {list.map((a, i) => (
                <div
                  key={a.id}
                  className="rounded-xl bg-ink p-3 ring-1 ring-line"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-5 text-center text-xs font-bold text-muted">
                      {i + 1}
                    </span>
                    <select
                      value={a.motion}
                      onChange={(e) => chooseMotion(a, e.target.value)}
                      className="input w-auto flex-1"
                      aria-label="Action"
                    >
                      {motions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input
                        type="number"
                        min={0.3}
                        max={30}
                        step={0.1}
                        value={a.seconds}
                        onChange={(e) =>
                          setAction(a, {
                            seconds: Math.min(
                              Math.max(Number(e.target.value) || 0.3, 0.3),
                              30,
                            ),
                          })
                        }
                        className="input w-20"
                        aria-label="Seconds"
                      />
                      sec
                    </label>
                    <button
                      onClick={() =>
                        update({ actions: list.filter((x) => x.id !== a.id) })
                      }
                      className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-red-300"
                      title="Remove"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-3 pl-8 text-xs text-muted">
                    <Switch
                      on={a.to !== null}
                      onChange={(v) => setAction(a, { to: v ? 0.8 : null })}
                      label="Move across the screen"
                    />
                    <span>Move across the screen</span>
                    {a.to !== null && (
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={a.to}
                        onChange={(e) =>
                          setAction(a, { to: Number(e.target.value) })
                        }
                        className="min-w-0 flex-1 accent-brand"
                        aria-label="Move to"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!list.length && (
              <p className="text-sm text-muted">
                Add the first action: walk in, wave, sit down…
              </p>
            )}
            <button onClick={addAction} className="btn-ghost mt-3">
              <Plus className="size-4" /> Add action
            </button>
          </Section>

          <Section n={3} title="Scene">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="label">Sky colour</span>
                <input
                  type="color"
                  value={project.bg_color}
                  onChange={(e) =>
                    update({ bg_color: e.target.value.toUpperCase() })
                  }
                  className="h-10 w-full cursor-pointer rounded-lg bg-transparent"
                />
              </label>
              <label className="text-sm">
                <span className="label">Ground colour</span>
                <input
                  type="color"
                  value={project.ground_color}
                  onChange={(e) =>
                    update({ ground_color: e.target.value.toUpperCase() })
                  }
                  className="h-10 w-full cursor-pointer rounded-lg bg-transparent"
                />
              </label>
              <label className="text-sm">
                <span className="label">Starts at</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={project.start_x}
                  onChange={(e) => update({ start_x: Number(e.target.value) })}
                  className="w-full accent-brand"
                />
              </label>
              <label className="text-sm">
                <span className="label">Character size</span>
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.05}
                  value={project.scale}
                  onChange={(e) => update({ scale: Number(e.target.value) })}
                  className="w-full accent-brand"
                />
              </label>
            </div>
          </Section>

          <button
            onClick={startRender}
            disabled={!list.length}
            className="btn-primary self-start px-6 py-3 text-base"
          >
            <Clapperboard className="size-5" /> Render video ({total.toFixed(1)}
            s)
          </button>
        </div>

        <aside className="lg:sticky lg:top-6">
          <PuppetPreview
            project={project}
            layers={layers}
            frames={frames}
            fps={fps}
            version={version}
          />
        </aside>
      </div>

      {render && (
        <RenderDialog state={render} onClose={() => setRender(null)} />
      )}
    </div>
  );
}
