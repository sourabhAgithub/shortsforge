import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { normWord } from "../ranking/layout";
import { KEYWORD_COLORS } from "../ranking/TitleEditor";

const TITLE_COLORS = [
  "#FFFFFF",
  "#FFE14D",
  ...KEYWORD_COLORS.filter((c) => c !== "#FACC15"),
];

function Swatches({
  value,
  onPick,
}: {
  value: string;
  onPick: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {TITLE_COLORS.map((c) => (
        <button
          key={c}
          title={c}
          onClick={() => onPick(c)}
          className={`size-7 rounded-full transition ${value.toUpperCase() === c ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-panel" : "ring-1 ring-white/15 hover:scale-105"}`}
          style={{ background: c }}
        />
      ))}
      <label
        className="relative size-7 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
        title="Custom color"
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value.toUpperCase())}
          className="absolute inset-0 opacity-0"
        />
      </label>
    </div>
  );
}

type Props = {
  title: string;
  what?: string; // "Title", or "Caption" when colouring captions
  color: string;
  highlights: Record<string, string>;
  onColor: (c: string) => void;
  onHighlights: (h: Record<string, string>) => void;
};

/** A highlight colour that differs from the title colour, so painted words stand out. */
const contrastWith = (color: string) =>
  TITLE_COLORS.find((c) => c !== color.toUpperCase() && c !== "#FFFFFF") ??
  "#F43F5E";

/** Title colour plus optional per-word highlight colours (click a word to paint it). */
export default function TitleColors({
  title,
  what = "Title",
  color,
  highlights,
  onColor,
  onHighlights,
}: Props) {
  const [brush, setBrush] = useState(() => contrastWith(color));
  const same = brush.toUpperCase() === color.toUpperCase();

  function pickTitleColor(c: string) {
    onColor(c);
    if (c.toUpperCase() === brush.toUpperCase()) setBrush(contrastWith(c));
  }
  const words = title.split(/\s+/).filter(Boolean);

  function toggle(word: string) {
    const key = normWord(word);
    if (!key) return;
    const { [key]: current, ...rest } = highlights;
    onHighlights(current === brush ? rest : { ...rest, [key]: brush });
  }

  return (
    <div className="mt-5 grid gap-5 sm:grid-cols-2">
      <div>
        <span className="label">{what} color</span>
        <Swatches value={color} onPick={pickTitleColor} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="label">Highlight words</span>
          {Object.keys(highlights).length > 0 && (
            <button
              onClick={() => onHighlights({})}
              className="mb-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-white"
            >
              <RotateCcw className="size-3" /> Clear
            </button>
          )}
        </div>
        <Swatches value={brush} onPick={setBrush} />
      </div>
      <div className="sm:col-span-2">
        {same ? (
          <p className="mb-2 text-xs text-amber">
            The highlight color is the same as the {what.toLowerCase()} color,
            so painted words won't stand out. Pick a different highlight color.
          </p>
        ) : (
          <p className="mb-2 text-xs text-muted">
            Click words below to paint them in the highlight color. Click a
            painted word again to remove it.
          </p>
        )}
        <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-line bg-ink p-3">
          {words.length === 0 && (
            <p className="text-sm text-muted">
              Type a {what.toLowerCase()} above, then click its words here.
            </p>
          )}
          {words.map((w, j) => {
            const c = highlights[normWord(w)];
            return (
              <button
                key={j}
                onClick={() => toggle(w)}
                className="rounded-lg bg-white/5 px-2.5 py-1 font-title text-sm tracking-wide transition hover:bg-white/10"
                style={{
                  color: c ?? color,
                  boxShadow: c ? `inset 0 0 0 1px ${c}66` : undefined,
                }}
              >
                {w}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
