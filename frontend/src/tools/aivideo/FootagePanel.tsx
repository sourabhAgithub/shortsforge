import { AlertCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { Job } from "../../api";
import type { AiSettings, Footage, Scene } from "./types";

const SOURCE_LABEL: Record<Footage["source"], string> = {
  upload: "Your upload",
  ai: "AI generated",
  stock: "Stock",
  gradient: "Gradient",
};

const SOURCES: [AiSettings["footage_source"], string][] = [
  ["ai", "AI generated"],
  ["stock", "Stock footage"],
  ["uploads", "My uploads only"],
];

type Props = {
  scenes: Scene[];
  source: AiSettings["footage_source"];
  busy: Set<string>;
  job: Job | null;
  error: string;
  onSource: (s: AiSettings["footage_source"]) => void;
  onGenerate: (sceneIds: string[]) => void;
};

export default function FootagePanel({ scenes, source, busy, job, error, onSource, onGenerate }: Props) {
  const missing = scenes.filter((s) => !s.footage).map((s) => s.id);
  const running = busy.size > 0;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-full sm:w-auto sm:min-w-48">
          <span className="label">Footage source</span>
          <select value={source} onChange={(e) => onSource(e.target.value as AiSettings["footage_source"])} className="input">
            {SOURCES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => onGenerate(missing.length ? missing : scenes.map((s) => s.id))}
          disabled={running || scenes.length === 0}
          className="btn-primary"
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {missing.length === scenes.length || !scenes.length ? "Generate footage" : missing.length ? `Generate ${missing.length} missing` : "Regenerate all"}
        </button>
        {running && job && <span className="pb-2.5 text-sm text-muted">{job.step}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        The script only <i>describes</i> each scene; this step makes the actual pictures from those descriptions so you can check them
        and regenerate any you don't like. It's optional: if you skip it, Render video does it automatically.
      </p>
      <p className="mt-1 text-xs text-muted">
        Your own uploads always win. Otherwise: AI image → stock footage (needs a Pixabay or Pexels key) → animated gradient. Images get a slow zoom.
      </p>
      {error && (
        <p className="mt-3 flex gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {scenes.length === 0 ? (
        <p className="mt-5 text-sm text-muted">Add scenes in step 3 first.</p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
          {scenes.map((s, i) => {
            const f = s.footage;
            const isBusy = busy.has(s.id);
            return (
              <div key={s.id} className="overflow-hidden rounded-xl bg-ink ring-1 ring-line">
                <div className="relative aspect-[9/16] bg-panel-2">
                  {f?.thumb && <img src={f.thumb} alt="" className={`size-full object-cover ${isBusy ? "opacity-30" : ""}`} />}
                  {isBusy && <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-sky" />}
                  {!f && !isBusy && <span className="absolute inset-0 grid place-items-center text-xs text-muted/60">No footage yet</span>}
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold">{i + 1}</span>
                  {f && (
                    <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold">
                      {SOURCE_LABEL[f.source]}
                      {f.kind === "video" ? " · video" : ""}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 p-2">
                  <p className="line-clamp-2 min-h-8 text-[11px] leading-4 text-muted" title={s.prompt}>
                    {s.prompt || s.label || "No prompt"}
                  </p>
                  {f?.note && (
                    <p className="line-clamp-2 text-[10px] leading-3.5 text-amber" title={f.note}>
                      {f.note}
                    </p>
                  )}
                  <button
                    onClick={() => onGenerate([s.id])}
                    disabled={isBusy || (running && !isBusy) || s.upload !== null}
                    className="btn-ghost w-full px-2 py-1 text-[11px]"
                    title={s.upload ? "This scene uses your upload" : "Make a new version of this scene"}
                  >
                    <RefreshCw className="size-3" /> Regenerate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
