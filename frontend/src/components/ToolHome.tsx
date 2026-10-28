import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatDate } from "../api";
import type { ToolDef } from "../tools/registry";

export type ProjectSummary = {
  id: string;
  title: string;
  updated_at: number;
  slots: number;
  filled: number;
  thumb: string | null;
};

type Props = {
  tool: Pick<ToolDef, "id" | "icon">;
  heading: string;
  blurb: string;
  createLabel: string;
  untitled: string;
  /** e.g. (p) => `${p.filled}/${p.slots} clips ready` */
  progress: (p: ProjectSummary) => string;
};

/** Tool landing page: big "create" card plus the list of saved projects. */
export default function ToolHome({ tool, heading, blurb, createLabel, untitled, progress }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const base = `/api/${tool.id}/projects`;
  const Icon = tool.icon;

  useEffect(() => {
    api<ProjectSummary[]>(base).then(setProjects).catch((e) => setError(e.message));
  }, [base]);

  async function create() {
    setCreating(true);
    try {
      const p = await api<{ id: string }>(base, { method: "POST" });
      navigate(`/${tool.id}/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(`Delete the project "${p.title || untitled}"? Videos you already made stay in My Videos.`)) return;
    try {
      await api(`${base}/${p.id}`, { method: "DELETE" });
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="card relative overflow-hidden p-5 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="grid size-16 place-items-center rounded-full bg-brand/20 text-sky ring-1 ring-brand/40">
            <Icon className="size-7" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black tracking-tight uppercase sm:text-3xl">{heading}</h1>
            <p className="mt-1 max-w-lg text-muted">{blurb}</p>
          </div>
          <button onClick={create} disabled={creating} className="btn-primary px-6 py-3 text-base">
            {creating ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />} {createLabel}
          </button>
        </div>
      </div>

      {error && <p className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      <h2 className="mt-10 mb-4 text-sm font-semibold tracking-wider text-muted uppercase">Your projects</h2>
      {projects?.length === 0 && <p className="text-sm text-muted">No projects yet. Create your first one above.</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects?.map((p) => (
          <div key={p.id} className="card group flex gap-4 p-4 transition hover:border-brand/40">
            <Link to={`/${tool.id}/${p.id}`} className="h-24 w-14 shrink-0 overflow-hidden rounded-lg bg-ink ring-1 ring-line">
              {p.thumb && <img src={p.thumb} alt="" className="size-full object-cover" />}
            </Link>
            <Link to={`/${tool.id}/${p.id}`} className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.title || untitled}</p>
              <p className="mt-1 text-xs text-muted">{progress(p)}</p>
              <p className="mt-0.5 text-xs text-muted/70">Edited {formatDate(p.updated_at)}</p>
            </Link>
            <button onClick={() => remove(p)} className="self-start rounded-lg p-1.5 text-muted transition group-hover:opacity-100 hover:bg-white/5 [@media(hover:hover)]:opacity-0 hover:text-red-300" title="Delete project">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
