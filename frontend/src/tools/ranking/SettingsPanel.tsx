import type { ReactNode } from "react";
import type { RankSettings } from "./types";

const HIGHLIGHT_COLORS = [
  "#FFE14D",
  "#4ADE80",
  "#2DD4BF",
  "#60A5FA",
  "#F43F5E",
  "#FB923C",
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Swatches({
  value,
  colors,
  onChange,
}: {
  value: string;
  colors: string[];
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`size-7 rounded-full ring-offset-2 ring-offset-panel ${value.toUpperCase() === c ? "ring-2 ring-white" : ""}`}
          style={{ background: c }}
          title={c}
        />
      ))}
      <label
        className="relative size-7 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
        title="Custom color"
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 opacity-0"
        />
      </label>
    </div>
  );
}

export default function SettingsPanel({
  s,
  onChange,
}: {
  s: RankSettings;
  onChange: (patch: Partial<RankSettings>) => void;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Field
        label="Clip length"
        hint={
          s.clip_length === "full"
            ? "each clip's whole trimmed part"
            : `up to ${s.max_seconds}s each`
        }
      >
        <div className="grid grid-cols-2 gap-1 rounded-full bg-ink p-1 ring-1 ring-line">
          {(
            [
              ["max", "Up to max seconds"],
              ["full", "Full clip (auto)"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => onChange({ clip_length: mode })}
              className={`rounded-full py-1.5 text-sm font-semibold transition ${s.clip_length === mode ? "bg-brand text-white" : "text-muted hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={2}
          max={30}
          step={0.5}
          value={s.max_seconds}
          disabled={s.clip_length === "full"}
          onChange={(e) => onChange({ max_seconds: Number(e.target.value) })}
          className="mt-3 w-full accent-brand disabled:opacity-30"
          title={`Max seconds per clip: ${s.max_seconds}s`}
        />
      </Field>
      <Field
        label="Title size"
        hint={`${s.title_font_size}px (shrinks to fit)`}
      >
        <input
          type="range"
          min={60}
          max={170}
          step={2}
          value={s.title_font_size}
          onChange={(e) =>
            onChange({ title_font_size: Number(e.target.value) })
          }
          className="w-full accent-brand"
        />
      </Field>
      <Field label="Clip framing">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-ink p-1 ring-1 ring-line">
          {(
            [
              ["fit", "Fit + blur"],
              ["fill", "Fill (crop)"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => onChange({ fit_mode: mode })}
              className={`rounded-full py-1.5 text-sm font-semibold transition ${s.fit_mode === mode ? "bg-brand text-white" : "text-muted hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Gold / silver / bronze for #1–3">
        <button
          role="switch"
          aria-checked={s.medal_colors}
          onClick={() => onChange({ medal_colors: !s.medal_colors })}
          className={`relative h-6 w-11 rounded-full transition ${s.medal_colors ? "bg-brand" : "bg-white/10"}`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${s.medal_colors ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </Field>
      <Field label="Keyword color" hint="for new highlights">
        <Swatches
          value={s.keyword_color}
          colors={["#2DD4BF", "#F43F5E", "#60A5FA", "#FACC15"]}
          onChange={(c) => onChange({ keyword_color: c })}
        />
      </Field>
      <Field label="Current rank color">
        <Swatches
          value={s.highlight_color}
          colors={HIGHLIGHT_COLORS}
          onChange={(c) => onChange({ highlight_color: c })}
        />
      </Field>
    </div>
  );
}
