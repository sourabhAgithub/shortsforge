import { Trash2, X } from "lucide-react";
import { useEffect } from "react";
import SoundTrim, { TimeBox } from "./SoundTrim";
import { type SoundClip, soundPlayed } from "./types";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const r2 = (v: number) => Math.round(v * 100) / 100;

type Props = {
  clip: SoundClip;
  total: number; // of the video
  onChange: (id: string, patch: Partial<SoundClip>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onListen: () => void; // about to play the sound on its own
};

/** Pop-up for one sound on the track: trim it, and set where and how it plays. */
export default function SoundEditor({
  clip,
  total,
  onChange,
  onRemove,
  onClose,
  onListen,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loops = clip.length > soundPlayed(clip) + 0.01;

  function setSpeed(speed: number) {
    const faster = { ...clip, speed };
    onChange(clip.id, {
      speed,
      // Plays its part once at any speed; a looped sound keeps its length.
      ...(loops
        ? {}
        : { length: r2(Math.min(soundPlayed(faster), total - clip.start)) }),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${clip.name}`}
        className="card w-full max-w-2xl p-4 sm:p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {clip.name}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted hover:text-white"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <SoundTrim
          clip={clip}
          total={total}
          onChange={onChange}
          onListen={onListen}
        />

        <div className="mt-4">
          <p className="mb-1.5 text-xs text-muted">
            Speed (faster sounds keep their pitch)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SPEEDS.map((v) => (
              <button
                key={v}
                onClick={() => setSpeed(v)}
                aria-pressed={clip.speed === v}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-line ${clip.speed === v ? "bg-brand text-white" : "text-muted hover:text-white"}`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-xs text-muted sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block">Starts in the video at (s)</span>
            <TimeBox
              value={clip.start}
              onCommit={(v) =>
                onChange(clip.id, {
                  start: r2(Math.min(Math.max(v, 0), total - 0.1)),
                })
              }
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block">
              Plays for (s){loops && " · loops"}
            </span>
            <TimeBox
              value={clip.length}
              onCommit={(v) =>
                onChange(clip.id, {
                  length: r2(Math.min(Math.max(v, 0.1), total - clip.start)),
                })
              }
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block">
              Volume {Math.round(clip.volume * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={clip.volume}
              onChange={(e) =>
                onChange(clip.id, { volume: Number(e.target.value) })
              }
              className="mt-2 w-full accent-brand"
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={() => onRemove(clip.id)}
            className="btn-ghost px-3 py-1.5 text-xs text-red-300"
          >
            <Trash2 className="size-3.5" /> Remove from timeline
          </button>
          <button onClick={onClose} className="btn-primary px-4 py-1.5 text-xs">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
