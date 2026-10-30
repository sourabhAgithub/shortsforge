import { Eraser, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import type { Footage } from "./types";

type Box = { x: number; y: number; w: number; h: number }; // fractions of the image

/** Where Gemini puts its sparkle: a small square in the bottom-right corner. */
function geminiBox(width: number, height: number): Box {
  const short = Math.min(width, height);
  const side = 0.12 * short;
  const margin = 0.015 * short;
  return {
    x: (width - margin - side) / width,
    y: (height - margin - side) / height,
    w: side / width,
    h: side / height,
  };
}

type Props = {
  projectId: string;
  photo: Footage;
  onApply: (f: Footage) => void;
  onClose: () => void;
};

/** Paint out a watermark or logo: drag a box over it, clean, repeat for other marks, then keep. */
export default function WatermarkDialog({
  projectId,
  photo,
  onApply,
  onClose,
}: Props) {
  const [current, setCurrent] = useState(photo);
  const [history, setHistory] = useState<Footage[]>([]);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const frame = useRef<HTMLDivElement>(null);

  const url = `/media/aivideo/${projectId}/${current.file}`;

  function point(e: { clientX: number; clientY: number }): [number, number] {
    const r = frame.current!.getBoundingClientRect();
    return [
      Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    ];
  }

  function draw(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const [x0, y0] = point(e);
    const prev = box;
    const move = (ev: PointerEvent) => {
      const [x1, y1] = point(ev);
      setBox({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      const [x1, y1] = point(ev);
      if (Math.abs(x1 - x0) < 0.01 || Math.abs(y1 - y0) < 0.01) setBox(prev); // a tap, not a drag
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  async function clean() {
    if (!box) return;
    setBusy(true);
    setError("");
    try {
      const f = await api<Footage>(
        `/api/aivideo/projects/${projectId}/clean-image`,
        {
          method: "POST",
          json: { file: current.file, box: [box.x, box.y, box.w, box.h] },
        },
      );
      setHistory((h) => [...h, current]);
      setCurrent(f);
      setBox(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function undo() {
    setCurrent(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="card relative w-full max-w-2xl p-4 sm:p-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 rounded-full p-1.5 text-muted hover:bg-white/5 hover:text-white"
          title="Close without changes"
        >
          <X className="size-4" />
        </button>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Eraser className="size-5 text-sky" /> Remove watermark
        </h2>
        <p className="mt-1 text-sm text-muted">
          Drag a box over the watermark or logo, then click <b>Clean</b>. Repeat
          for other marks. Keep the box close around the mark for the best
          result.
        </p>

        <div className="mt-4 grid place-items-center rounded-xl bg-ink p-2 ring-1 ring-line">
          <div
            ref={frame}
            onPointerDown={draw}
            className="relative cursor-crosshair touch-none select-none"
          >
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                setSize([w, h]);
                if (!history.length && !box) setBox(geminiBox(w, h));
              }}
              className="block max-h-[60vh] max-w-full"
            />
            {box && (
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-dashed border-amber bg-amber/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              />
            )}
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-black/40">
                <Loader2 className="size-7 animate-spin text-sky" />
              </div>
            )}
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={clean}
            disabled={!box || busy}
            className="btn-primary"
          >
            <Eraser className="size-4" /> Clean
          </button>
          <button
            onClick={() => size && setBox(geminiBox(...size))}
            disabled={!size || busy}
            className="btn-ghost"
            title="Select the bottom-right corner, where Gemini puts its sparkle"
          >
            <Sparkles className="size-4" /> Gemini corner
          </button>
          <button
            onClick={undo}
            disabled={!history.length || busy}
            className="btn-ghost"
          >
            <RotateCcw className="size-4" /> Undo
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button
              onClick={() => onApply(current)}
              disabled={!history.length || busy}
              className="btn-primary"
            >
              Use cleaned photo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
