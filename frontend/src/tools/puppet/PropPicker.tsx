import { Plus, Trash2 } from "lucide-react";
import Switch from "../../components/Switch";
import { type PropArt, PROPS } from "./figure";
import type { Prop } from "./types";

type Props = {
  props: Prop[];
  onChange: (props: Prop[]) => void;
};

const newId = () => Math.random().toString(16).slice(2, 10);

/** Houses, trees and so on: add as many as you like, each one placed and removed on its own. */
export default function PropPicker({ props, onChange }: Props) {
  function add(art: PropArt) {
    const x = ((props.length * 3) % 8) / 10 + 0.15; // spread out, not stacked on the last one
    onChange([
      ...props,
      {
        id: newId(),
        kind: art.kind,
        x,
        y: art.y,
        scale: art.scale,
        flip: false,
        front: false,
      },
    ]);
  }

  const set = (p: Prop, patch: Partial<Prop>) =>
    onChange(props.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));

  const slider = (
    p: Prop,
    field: "x" | "y" | "scale",
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="text-xs text-muted">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={p[field]}
        onChange={(e) => set(p, { [field]: Number(e.target.value) })}
        className="mt-1 w-full accent-brand"
      />
    </label>
  );

  return (
    <div className="mt-5">
      <p className="label">Add to the scene</p>
      <div className="flex flex-wrap gap-1.5">
        {PROPS.map((art) => (
          <button
            key={art.kind}
            onClick={() => add(art)}
            className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-muted ring-1 ring-line hover:text-white"
          >
            <Plus className="size-3" /> {art.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {props.map((p) => (
          <div key={p.id} className="rounded-xl bg-ink p-3 ring-1 ring-line">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm font-semibold">
                {PROPS.find((a) => a.kind === p.kind)?.label ?? p.kind}
              </span>
              <span className="text-xs text-muted">In front of people</span>
              <Switch
                on={p.front}
                onChange={(front) => set(p, { front })}
                label="In front of people"
              />
              <span className="text-xs text-muted">Flip</span>
              <Switch
                on={p.flip}
                onChange={(flip) => set(p, { flip })}
                label="Flip"
              />
              <button
                onClick={() => onChange(props.filter((x) => x.id !== p.id))}
                className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-red-300"
                title="Remove"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {slider(p, "x", "Left / right", 0, 1)}
              {slider(p, "y", "Up / down", 0, 1)}
              {slider(p, "scale", "Size", 0.2, 4)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
