import {
  ArrowDown,
  ArrowUp,
  Eraser,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import Switch from "../../components/Switch";
import { MEDALS } from "../ranking/layout";
import { type Fit, FITS, MOTIONS, type Motion, type Scene } from "./types";
import WatermarkDialog from "./WatermarkDialog";

type Props = {
  projectId: string;
  scene: Scene;
  index: number;
  count: number;
  timing: [number, number] | null;
  uploading: boolean;
  // Whole-video settings: when off, the scene's own switches don't apply.
  rankingOn: boolean;
  labelsOn: boolean;
  captionsOn: boolean;
  onChange: (patch: Partial<Scene>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onUpload: (file: File) => void;
};

function num(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function SceneRow({
  projectId,
  scene,
  index,
  count,
  timing,
  uploading,
  rankingOn,
  labelsOn,
  captionsOn,
  onChange,
  onRemove,
  onMove,
  onUpload,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cleaning, setCleaning] = useState(false);
  const medal = scene.rank ? MEDALS[scene.rank] : undefined;
  return (
    <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:gap-4 sm:p-4">
      {/* Phones: number, arrows and media sit in a row above the fields. */}
      <div className="flex items-start gap-3 sm:contents">
        <div className="flex items-center gap-1 sm:flex-col">
          <div className="grid size-10 place-items-center rounded-full text-sm font-black ring-1 ring-line">
            {index + 1}
          </div>
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="rounded p-1 text-muted hover:text-white disabled:opacity-20"
            title="Move up"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            className="rounded p-1 text-muted hover:text-white disabled:opacity-20"
            title="Move down"
          >
            <ArrowDown className="size-3.5" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:w-20 sm:flex-col sm:items-stretch sm:gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            className="group relative aspect-[9/16] w-12 shrink-0 overflow-hidden sm:w-full rounded-xl bg-ink ring-1 ring-line hover:ring-brand"
            title="Use your own image or video for this scene"
          >
            {uploading ? (
              <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-sky" />
            ) : scene.upload?.thumb ? (
              <img
                src={scene.upload.thumb}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-muted/60 group-hover:text-white">
                <ImagePlus className="size-5" />
              </span>
            )}
          </button>
          {scene.upload?.kind === "image" && (
            <button
              onClick={() => setCleaning(true)}
              className="inline-flex items-center justify-center gap-1 text-[11px] text-sky hover:text-white"
              title="Remove a watermark or logo (like Gemini's sparkle) from this photo"
            >
              <Eraser className="size-3" /> Watermark
            </button>
          )}
          {scene.upload ? (
            <button
              onClick={() => onChange({ upload: null, footage: null })}
              className="inline-flex items-center justify-center gap-1 text-[11px] text-muted hover:text-red-300"
            >
              <X className="size-3" /> Remove
            </button>
          ) : (
            <span className="text-[10px] leading-tight text-muted/60 sm:text-center">
              Own media (optional)
            </span>
          )}
          {cleaning && scene.upload && (
            <WatermarkDialog
              projectId={projectId}
              photo={scene.upload}
              onApply={(f) => {
                onChange({ upload: f, footage: f });
                setCleaning(false);
              }}
              onClose={() => setCleaning(false)}
            />
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-bold text-white">Scene {index + 1}</span>
          {timing && (
            <span className="rounded-md bg-white/5 px-2 py-0.5">
              {timing[0].toFixed(1)}–{timing[1].toFixed(1)}s
            </span>
          )}
          {/* Phones: the time fields get their own line under the scene name. */}
          <span className="order-last flex w-full items-center gap-2 sm:order-none sm:ml-2 sm:w-auto">
            <span>Time</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={scene.start ?? ""}
              placeholder="auto"
              onChange={(e) => onChange({ start: num(e.target.value) })}
              className="input w-20 py-1.5"
            />
            <span>to</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={scene.end ?? ""}
              placeholder="auto"
              onChange={(e) => onChange({ end: num(e.target.value) })}
              className="input w-20 py-1.5"
            />
            <span>s</span>
          </span>
          <button
            onClick={onRemove}
            disabled={count <= 1}
            className="ml-auto rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-red-300 disabled:opacity-20"
            title="Remove scene"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="label mb-0">Voiceover (captions)</span>
          {captionsOn ? (
            <label className="flex items-center gap-2 text-[11px] text-muted">
              Show captions
              <Switch
                on={scene.show_captions !== false}
                onChange={(v) => onChange({ show_captions: v })}
                label="Show captions for this scene"
              />
            </label>
          ) : (
            <span className="text-[11px] text-muted">
              Captions off for the whole video
            </span>
          )}
        </div>
        <textarea
          value={scene.voiceover}
          rows={2}
          onChange={(e) => onChange({ voiceover: e.target.value })}
          placeholder="Voiceover text for this scene (used for captions)"
          className="input resize-y"
        />
        <div className="grid items-start gap-x-2 gap-y-2.5 sm:grid-cols-2">
          {labelsOn && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="label mb-0">On-screen label</span>
                <label className="flex items-center gap-2 text-[11px] text-muted">
                  Show
                  <Switch
                    on={scene.show_label !== false}
                    onChange={(v) => onChange({ show_label: v })}
                    label="Show the label in this scene"
                  />
                </label>
              </div>
              <input
                value={scene.label}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder='On-screen label, e.g. "61 km²"'
                className="input"
              />
              {scene.label.trim() && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span>Show from</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={scene.label_start ?? ""}
                    placeholder="start"
                    onChange={(e) =>
                      onChange({ label_start: num(e.target.value) })
                    }
                    className="input w-16 px-2 py-1 text-xs"
                  />
                  <span>to</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={scene.label_end ?? ""}
                    placeholder="end"
                    onChange={(e) =>
                      onChange({ label_end: num(e.target.value) })
                    }
                    className="input w-16 px-2 py-1 text-xs"
                  />
                  <span>s</span>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Ranking list</span>
              {rankingOn ? (
                <label className="flex items-center gap-2 text-[11px] text-muted">
                  Show
                  <Switch
                    on={scene.show_ranks !== false}
                    onChange={(v) => onChange({ show_ranks: v })}
                    label="Show the ranking list in this scene"
                  />
                </label>
              ) : (
                <span className="text-[11px] text-muted">
                  Off for the whole video
                </span>
              )}
            </div>
            <div className={`flex gap-2 ${rankingOn ? "" : "opacity-40"}`}>
              <select
                value={scene.rank ?? ""}
                onChange={(e) =>
                  onChange({
                    rank: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="input w-28 shrink-0 sm:w-24"
                style={medal ? { color: medal } : undefined}
                title="Rank this scene reveals in the ranking list"
              >
                <option value="">No rank</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => (
                  <option key={r} value={r}>
                    #{r}
                  </option>
                ))}
              </select>
              <input
                value={scene.rank_name}
                disabled={!scene.rank}
                onChange={(e) => onChange({ rank_name: e.target.value })}
                placeholder={scene.rank ? "Name in ranking list" : "—"}
                className="input min-w-0 disabled:opacity-40"
              />
            </div>
          </div>
        </div>
        <span className="label">Footage prompt</span>
        <textarea
          value={scene.prompt}
          rows={2}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="Footage prompt: what should be on screen, e.g. Hilltop castle in the clouds"
          className="input resize-y"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Framing</span>
          <select
            value={scene.fit ?? "fill"}
            onChange={(e) => onChange({ fit: e.target.value as Fit })}
            className="input w-full py-1.5 sm:w-72"
          >
            {FITS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Image motion</span>
          <select
            value={scene.motion ?? "auto"}
            onChange={(e) => onChange({ motion: e.target.value as Motion })}
            className="input w-full py-1.5 sm:w-56"
          >
            {MOTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {(scene.upload ?? scene.footage)?.kind === "video" && (
            <span className="text-[11px] text-muted">
              This scene uses a video clip, which plays as is. Motion applies to
              images only.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
