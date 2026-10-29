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
          className={`size-7 rounded-full ring-1 ring-white/10 ring-offset-2 ring-offset-panel transition ${value.toUpperCase() === c ? "ring-2 ring-white" : ""}`}
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
  color: string;
  highlights: Record<string, string>;
  onColor: (c: string) => void;
  onHighlights: (h: Record<string, string>) => void;
};

/** Title colour plus optional per-word highlight colours (click a word to paint it). */
export default function TitleColors({
  title,
  color,
  highlights,
  onColor,
  onHighlights,
}: Props) {
  const [brush, setBrush] = useState(KEYWORD_COLORS[1]);
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
        <span className="label">Title color</span>
        <Swatches value={color} onPick={onColor} />
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
        <p className="mb-2 text-xs text-muted">
          Pick a highlight color, then click words to paint them. Click again to
          remove.
        </p>
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-ink p-3">
          {words.length === 0 && (
            <p className="text-sm text-muted">
              Type a title above, then click its words here.
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
