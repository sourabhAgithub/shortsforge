import { AlertCircle, ArrowDown, ArrowUp, Loader2, RefreshCw, Scissors, Send, Trash2, Upload, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { formatSeconds } from "../../api";
import { MEDALS } from "./layout";
import type { Slot } from "./types";

export type SlotStatus = { busy: boolean; step?: string; progress?: number; error?: string };

type Props = {
  slot: Slot;
  rank: number;
  count: number;
  canRemove: boolean;
  status?: SlotStatus;
  onChange: (patch: Partial<Slot>) => void;
  onDownload: (url: string) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
};

function numOrNull(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function SlotCard({ slot, rank, count, canRemove, status, onChange, onDownload, onUpload, onRemove, onMove }: Props) {
  const [showTrim, setShowTrim] = useState(slot.start != null || slot.end != null);
  const fileRef = useRef<HTMLInputElement>(null);
  const medal = MEDALS[rank];
  const clip = slot.clip;

  return (
    <div className="card flex gap-3 p-3 sm:gap-4 sm:p-4">
      <div className="flex flex-col items-center gap-1">
        <div
          className="grid size-10 place-items-center rounded-full text-sm font-black ring-1 ring-line"
          style={medal ? { background: `${medal}22`, color: medal, boxShadow: `inset 0 0 0 1px ${medal}66` } : undefined}
        >
          <span className={medal ? "" : "text-white"}>#{rank}</span>
        </div>
        <button onClick={() => onMove(-1)} disabled={rank === 1} className="rounded p-1 text-muted hover:text-white disabled:opacity-20" title="Move up a rank">
          <ArrowUp className="size-3.5" />
        </button>
        <button onClick={() => onMove(1)} disabled={rank === count} className="rounded p-1 text-muted hover:text-white disabled:opacity-20" title="Move down a rank">
          <ArrowDown className="size-3.5" />
        </button>
      </div>

      <div className="relative hidden aspect-[9/16] w-20 shrink-0 overflow-hidden sm:block rounded-xl bg-ink ring-1 ring-line">
        {clip ? (
          <img src={clip.thumb} alt="" className="size-full object-cover" />
        ) : status?.busy ? (
          <div className="grid size-full place-items-center">
            <Loader2 className="size-5 animate-spin text-sky" />
          </div>
        ) : (
          <div className="grid size-full place-items-center text-[10px] font-semibold text-muted/50">EMPTY</div>
        )}
        {clip && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] font-semibold">{formatSeconds(clip.duration)}</span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">Rank {rank}</span>
          <button onClick={onRemove} disabled={!canRemove} className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-red-300 disabled:opacity-20" title="Remove this rank">
            <Trash2 className="size-4" />
          </button>
        </div>

        {clip ? (
          <div className="flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 truncate text-muted" title={clip.url ?? clip.title}>
              {clip.title || clip.url || "Uploaded clip"}
            </span>
            {!clip.has_audio && <VolumeX className="size-4 shrink-0 text-muted" aria-label="No sound" />}
            <button onClick={() => onChange({ clip: null })} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-sky hover:text-white">
              <RefreshCw className="size-3" /> Replace
            </button>
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (slot.url.trim() && !status?.busy) onDownload(slot.url.trim());
            }}
          >
            <input
              value={slot.url}
              disabled={status?.busy}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="Paste a YouTube, Instagram or TikTok link"
              className="input min-w-0"
            />
            <button type="submit" disabled={!slot.url.trim() || status?.busy} className="btn-primary shrink-0 px-3.5" title="Download clip">
              {status?.busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
            <button type="button" disabled={status?.busy} onClick={() => fileRef.current?.click()} className="btn-ghost shrink-0 px-3.5" title="Upload a video file from your computer">
              <Upload className="size-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </form>
        )}

        {status?.busy && (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-sky transition-all" style={{ width: `${Math.max(4, (status.progress ?? 0) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">{status.step}</p>
          </div>
        )}
        {status?.error && !status.busy && (
          <p className="flex gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="mt-px size-3.5 shrink-0" /> {status.error}
          </p>
        )}

        <div className="flex gap-2">
          <input
            value={slot.caption}
            maxLength={40}
            onChange={(e) => onChange({ caption: e.target.value })}
            placeholder={`Caption for #${rank}, e.g. "Aura Lost"`}
            className="input min-w-0"
          />
          <button
            onClick={() => setShowTrim((v) => !v)}
            className={`btn-ghost shrink-0 px-3.5 ${showTrim ? "text-sky" : ""}`}
            title="Trim: choose which part of the clip plays"
          >
            <Scissors className="size-4" />
          </button>
        </div>

        {showTrim && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Play from</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={slot.start ?? ""}
              placeholder="0"
              onChange={(e) => onChange({ start: numOrNull(e.target.value) })}
              className="input w-20 py-1.5"
            />
            <span>to</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={slot.end ?? ""}
              placeholder={clip ? clip.duration.toFixed(1) : "end"}
              onChange={(e) => onChange({ end: numOrNull(e.target.value) })}
              className="input w-20 py-1.5"
            />
            <span>seconds</span>
          </div>
        )}
      </div>
    </div>
  );
}
