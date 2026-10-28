import { useEffect, useState } from "react";
import {
  BAND_H,
  clean,
  fitRankSize,
  fitTitleSize,
  H,
  LIST_TOP,
  LIST_X,
  MEDALS,
  normWord,
  playbackOrder,
  rankMetrics,
  strokeFor,
  titleLines,
  W,
} from "./layout";
import type { Project } from "./types";

const PREVIEW_W = 300;

/** Static HTML version of one moment of the final video: `step` = index into the playback order. */
export default function PhonePreview({ project, step }: { project: Project; step: number }) {
  const [, setFontsReady] = useState(0);
  useEffect(() => {
    // Re-measure once the title font has loaded (canvas measurement needs it).
    document.fonts.load('80px "Title Black"').then(() => setFontsReady((n) => n + 1));
  }, []);

  const s = project.settings;
  const order = playbackOrder(project);
  const active = order[Math.min(step, order.length - 1)];
  const revealed = new Set(order.slice(0, step + 1));
  const activeSlot = project.slots[active - 1];
  const thumb = activeSlot?.clip?.thumb;

  const colors = new Map(project.highlights.map((h) => [normWord(h.word), h.color]));
  const lines = titleLines(project.title);
  const titleSize = fitTitleSize(lines, s.title_font_size);
  const titleStroke = strokeFor(titleSize);
  const lineH = titleSize * 1.15;
  const { spacing, size: rankBase } = rankMetrics(project.slots.length);
  const scale = PREVIEW_W / W;

  return (
    <div className="rounded-[2.4rem] bg-gradient-to-b from-white/15 to-white/5 p-2.5 shadow-2xl shadow-black/60">
      <div className="relative overflow-hidden rounded-[2rem] bg-black" style={{ width: PREVIEW_W, height: (PREVIEW_W * H) / W }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          {/* clip area */}
          <div className="absolute left-0 overflow-hidden" style={{ top: BAND_H, width: W, height: H - BAND_H }}>
            {thumb ? (
              s.fit_mode === "fill" ? (
                <img src={thumb} className="size-full object-cover" alt="" />
              ) : (
                <>
                  <img src={thumb} className="absolute inset-0 size-full scale-110 object-cover blur-[40px] brightness-[0.8]" alt="" />
                  <img src={thumb} className="absolute inset-0 size-full object-contain" alt="" />
                </>
              )
            ) : (
              <div className="grid size-full place-items-center bg-gradient-to-br from-[#1a1d3a] to-[#0d1424]">
                <span className="font-sans text-[56px] font-bold text-white/25">Rank {active} clip</span>
              </div>
            )}
          </div>

          {/* title band */}
          <div className="absolute top-0 left-0 flex flex-col justify-center bg-black" style={{ width: W, height: BAND_H }}>
            {lines.length === 0 && (
              <div className="text-center font-sans text-[54px] font-bold text-white/25">Your title goes here</div>
            )}
            {lines.map((words, i) => (
              <div
                key={i}
                className="stroke-text text-center whitespace-nowrap"
                style={{
                  fontFamily: "var(--font-title)",
                  fontSize: titleSize,
                  lineHeight: `${lineH}px`,
                  WebkitTextStrokeWidth: titleStroke * 2,
                }}
              >
                {words.map((w, j) => (
                  <span key={j} style={{ color: colors.get(normWord(w)) ?? "#fff" }}>
                    {w}
                    {j < words.length - 1 ? " " : ""}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {/* rank list */}
          {project.slots.map((slot, i) => {
            const rank = i + 1;
            const cap = revealed.has(rank) ? clean(slot.caption) : "";
            const size = fitRankSize(`${rank}.${cap ? " " + cap : ""}`, rankBase);
            const stroke = Math.max(4, Math.round(size * 0.12));
            const isActive = rank === active;
            const numColor = isActive ? s.highlight_color : s.medal_colors ? (MEDALS[rank] ?? "#fff") : "#fff";
            return (
              <div
                key={slot.id}
                className="stroke-text absolute flex items-center whitespace-nowrap"
                style={{
                  top: LIST_TOP + i * spacing,
                  height: spacing,
                  left: LIST_X + stroke,
                  fontFamily: "var(--font-title)",
                  fontSize: size,
                  WebkitTextStrokeWidth: stroke * 2,
                }}
              >
                <span style={{ color: numColor }}>{rank}.</span>
                {cap && <span style={{ color: isActive ? s.highlight_color : "#fff" }}>&nbsp;{cap}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
