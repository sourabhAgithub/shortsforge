import { CheckCircle2, Lightbulb } from "lucide-react";
import { normWord } from "./layout";
import type { Highlight } from "./types";

export const KEYWORD_COLORS = [
  "#2DD4BF",
  "#F43F5E",
  "#60A5FA",
  "#FACC15",
  "#4ADE80",
  "#FB923C",
  "#F472B6",
  "#A78BFA",
];

/** Keep at most two lines: anything after the first line break is folded into line 2. */
function twoLines(value: string): string {
  const [first, ...rest] = value.split("\n");
  return rest.length ? `${first}\n${rest.join(" ")}` : first;
}

type Props = {
  title: string;
  highlights: Highlight[];
  color: string;
  onTitle: (title: string) => void;
  onHighlights: (h: Highlight[]) => void;
  onColor: (c: string) => void;
};

export default function TitleEditor({
  title,
  highlights,
  color,
  onTitle,
  onHighlights,
  onColor,
}: Props) {
  const lines = title.split("\n").filter((l) => l.trim());
  const colorOf = new Map(highlights.map((h) => [normWord(h.word), h.color]));

  function toggle(word: string) {
    const key = normWord(word);
    if (!key) return;
    const current = colorOf.get(key);
    const rest = highlights.filter((h) => normWord(h.word) !== key);
    onHighlights(current === color ? rest : [...rest, { word: key, color }]);
  }

  return (
    <div>
      <textarea
        value={title}
        rows={2}
        placeholder={"Ranking Best\nParkour Fails"}
        onChange={(e) => onTitle(twoLines(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.includes("\n")) e.preventDefault();
        }}
        className="input resize-none font-title text-lg leading-snug tracking-wide"
      />
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {lines.length >= 2 ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="size-3.5" /> Two lines, the ideal format
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-amber">
            <Lightbulb className="size-3.5" /> Press Enter where you want the
            second line. Two lines look best.
          </span>
        )}
      </div>

      <div className="mt-5">
        <span className="label">
          Highlight keywords: click the words to color them
        </span>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {KEYWORD_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => onColor(c)}
              className={`size-7 rounded-full ring-offset-2 ring-offset-panel transition ${color === c ? "ring-2 ring-white" : ""}`}
              style={{ background: c }}
            />
          ))}
          <label
            className="relative size-7 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
            title="Custom color"
          >
            <input
              type="color"
              value={color}
              onChange={(e) => onColor(e.target.value.toUpperCase())}
              className="absolute inset-0 opacity-0"
            />
          </label>
        </div>
        <div className="space-y-2 rounded-xl border border-line bg-ink p-3">
          {lines.length === 0 && (
            <p className="text-sm text-muted">
              Type a title above, then click its words here.
            </p>
          )}
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              {line
                .split(/\s+/)
                .filter(Boolean)
                .map((w, j) => {
                  const c = colorOf.get(normWord(w));
                  return (
                    <button
                      key={j}
                      onClick={() => toggle(w)}
                      className={`rounded-lg px-2.5 py-1 font-title text-sm tracking-wide transition ${
                        c
                          ? "bg-white/10"
                          : "bg-white/5 text-white hover:bg-white/10"
                      }`}
                      style={
                        c
                          ? { color: c, boxShadow: `inset 0 0 0 1px ${c}66` }
                          : undefined
                      }
                    >
                      {w}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
