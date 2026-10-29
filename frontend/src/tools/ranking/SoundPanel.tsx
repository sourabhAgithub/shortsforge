import { Loader2, Music, Upload, X } from "lucide-react";
import { useRef } from "react";
import type { AudioMode, MediaFile, RankSettings } from "./types";

const MODES: [AudioMode, string, string][] = [
  ["original", "Clips' original sound", "Each clip plays its own audio."],
  [
    "external",
    "My audio only",
    "Your uploaded track replaces the clips' sound.",
  ],
  ["both", "Both mixed", "Your track plays under the clips' sound."],
];

type Props = {
  s: RankSettings;
  audio: MediaFile | null;
  uploading: boolean;
  error: string;
  onChange: (patch: Partial<RankSettings>) => void;
  onUpload: (f: File) => void;
  onRemove: () => void;
};

function Volume({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-muted">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </label>
  );
}

/** Choose the clips' own sound, an uploaded track (music or voiceover), or both. */
export default function SoundPanel({
  s,
  audio,
  uploading,
  error,
  onChange,
  onUpload,
  onRemove,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
  const needsAudio = s.audio_mode !== "original";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map(([mode, label, hint]) => (
          <button
            key={mode}
            onClick={() => onChange({ audio_mode: mode })}
            className={`rounded-xl px-4 py-3 text-left ring-1 transition ${s.audio_mode === mode ? "bg-brand/15 ring-brand" : "bg-ink ring-line hover:ring-white/20"}`}
          >
            <span className="block text-sm font-semibold">{label}</span>
            <span className="mt-0.5 block text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>

      {needsAudio && (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => file.current?.click()}
              disabled={uploading}
              className="btn-ghost"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {audio ? "Replace audio" : "Upload audio (MP3/WAV)"}
            </button>
            {audio && (
              <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                <Music className="size-4 shrink-0 text-muted" />{" "}
                <span className="min-w-0 break-all">{audio.name}</span>
                <span className="text-muted">
                  · {audio.duration.toFixed(1)}s
                </span>
                <button
                  onClick={onRemove}
                  className="rounded p-1 text-muted hover:text-red-300"
                  title="Remove audio"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
            <input
              ref={file}
              type="file"
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </div>
          {error && (
            <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {!audio && !error && (
            <p className="mt-2 text-xs text-amber">
              Upload a track, or the video keeps the clips' original sound.
            </p>
          )}
          {audio && (
            <p className="mt-2 text-xs text-muted">
              The track starts with the video, loops if it's shorter, and fades
              out at the end.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {s.audio_mode !== "external" && (
          <Volume
            label="Clips' sound volume"
            value={s.original_volume}
            onChange={(original_volume) => onChange({ original_volume })}
          />
        )}
        {needsAudio && audio && (
          <Volume
            label="Your audio volume"
            value={s.external_volume}
            onChange={(external_volume) => onChange({ external_volume })}
          />
        )}
      </div>
      <p className="text-xs text-muted">
        Turn off the sound of single clips with "Edit clip" on that clip.
      </p>
    </div>
  );
}
