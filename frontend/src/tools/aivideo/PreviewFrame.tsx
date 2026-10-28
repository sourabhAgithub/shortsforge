import { type ReactNode, useEffect, useRef, useState } from "react";
import { measure } from "../ranking/layout";
import {
  ACCENT,
  BANNER_H,
  CAPTION_CY,
  FLASH,
  GOLD,
  GRADIENTS,
  H,
  LABEL_CY,
  LIST_TOP,
  LIST_X,
  MEDALS,
  ROW_FONT,
  ROW_H,
  W,
} from "./layout";
import { type AiProject, type Fit, type Footage, imageMotion, labelWindow, type Motion, sceneCues } from "./types";

const stroke = (size: number, ratio = 0.09) => Math.max(3, Math.round(size * ratio));

function fit(text: string, maxW: number, maxSize: number, minSize = 24, ratio = 0.09) {
  let size = maxSize;
  while (size > minSize && measure(text, size) + 2 * stroke(size, ratio) > maxW) size -= 2;
  return size;
}

/** One or two balanced lines plus a font size, like wrap_balanced() + fit_size() in Python. */
function lines(text: string, maxW: number, maxOne: number, maxTwo: number, wrapAt: number): [string[], number] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || measure(text, wrapAt) <= maxW) return [[text], fit(text, maxW, maxOne)];
  let best = [text];
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const s = Math.max(measure(a, wrapAt), measure(b, wrapAt));
    if (s < score) [best, score] = [[a, b], s];
  }
  return [best, Math.min(...best.map((l) => fit(l, maxW, maxTwo)))];
}

function Outlined({ text, size, color = "#fff", ratio = 0.09 }: { text: string; size: number; color?: string; ratio?: number }) {
  return (
    <div
      className="stroke-text whitespace-nowrap"
      style={{ fontFamily: "var(--font-title)", fontSize: size, lineHeight: 1.18, color, WebkitTextStrokeWidth: stroke(size, ratio) * 2 }}
    >
      {text}
    </div>
  );
}

/** Picture framed like the renderer's _frame(): crop to fill, or whole over blur / black. */
function Framed({ fit, children, blurSrc }: { fit: Fit; children: (cls: string) => ReactNode; blurSrc: ReactNode }) {
  if (fit === "fit_blur")
    return (
      <div className="relative size-full overflow-hidden">
        <div className="absolute inset-0 scale-110 blur-[30px] brightness-[0.85]">{blurSrc}</div>
        <div className="absolute inset-0">{children("size-full object-contain")}</div>
      </div>
    );
  if (fit === "fit_black") return <div className="size-full bg-black">{children("size-full object-contain")}</div>;
  return <>{children("size-full object-cover")}</>;
}

function FootageView({ f, url, index, local, dur, playing, motion, fit }: { f: Footage | null; url: string | null; index: number; local: number; dur: number; playing: boolean; motion: Motion; fit: Fit }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v || !v.duration) return;
    const want = local % v.duration;
    if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [local, playing]);

  if (!f || f.kind === "gradient" || !url) {
    const [c0, c1] = GRADIENTS[index % GRADIENTS.length];
    return <div className="size-full" style={{ background: `linear-gradient(${135 + local * 8}deg, ${c0}, ${c1})` }} />;
  }
  if (f.kind === "video")
    return (
      <Framed fit={fit} blurSrc={f.thumb ? <img src={f.thumb} alt="" className="size-full object-cover" /> : null}>
        {(cls) => <video ref={video} src={url} muted loop playsInline className={cls} />}
      </Framed>
    );
  // Same movements as the renderer's zoompan (see _footage_filter in render.py).
  const p = Math.min(1, local / Math.max(dur, 0.1));
  const shift = 6.5 - 13 * p; // % of the frame, +6.5 → -6.5 across the scene
  const transform = {
    auto: "",
    still: "none",
    zoom_in: `scale(${1 + 0.15 * p})`,
    zoom_out: `scale(${1.15 - 0.15 * p})`,
    pan_right: `scale(1.15) translateX(${shift}%)`,
    pan_left: `scale(1.15) translateX(${-shift}%)`,
    pan_down: `scale(1.15) translateY(${shift}%)`,
    pan_up: `scale(1.15) translateY(${-shift}%)`,
  }[imageMotion(motion, index)];
  return (
    <div className="size-full" style={{ transform }}>
      <Framed fit={fit} blurSrc={<img src={url} alt="" className="size-full object-cover" />}>
        {(cls) => <img src={url} alt="" className={cls} />}
      </Framed>
    </div>
  );
}

type Props = { project: AiProject; timings: [number, number][]; t: number; playing: boolean; width?: number };

/** Static HTML version of the rendered video at time `t`. */
export default function PreviewFrame({ project, timings, t, playing, width = 300 }: Props) {
  const [, setFonts] = useState(0);
  useEffect(() => {
    document.fonts.load('80px "Title Black"').then(() => setFonts((n) => n + 1));
  }, []);

  const scenes = project.scenes;
  let i = 0;
  while (i < timings.length - 1 && t >= timings[i + 1][0]) i++;
  const scene = scenes[i];
  const [a, b] = timings[i] ?? [0, 1];
  const local = Math.max(0, t - a);
  const s = project.settings;

  const f = scene?.upload ?? scene?.footage ?? null;
  const fullscreen = scene?.fit === "fullscreen";
  const url = f?.file ? `/media/aivideo/${project.id}/${f.file}` : (f?.thumb ?? null);

  const ranks = new Map<number, string>();
  scenes.forEach((x) => x.rank && ranks.set(x.rank, x.rank_name || (x.voiceover.match(/^\s*#\d+\s+([^:,.;!?]*)/)?.[1] ?? "").trim()));
  const revealed = new Set(scenes.slice(0, i + 1).map((x) => x.rank).filter(Boolean));
  const n = ranks.size ? Math.max(...ranks.keys()) : 0;

  const title = project.title.split(/\s+/).filter(Boolean).join(" ");
  const [titleLines, titleSize] = title ? lines(title, W - 80, 96, 84, 64) : [[], 0];
  const [la, lb] = scene ? labelWindow(scene, a, b) : [0, 0];
  const label = scene && scene.show_label !== false && t >= la && t < lb ? scene.label.trim() : "";
  const [labelLines, labelSize] = label ? lines(label, 940, 110, 92, 96) : [[], 0];
  const cue = scene && s.captions ? sceneCues(scene, a, b).find((c) => t >= c.start && t < c.end) : undefined;
  const [capLines, capSize] = cue ? lines(cue.text, 1000, 84, 84, 80) : [[], 0];
  const slide = Math.pow(1 - Math.min(Math.max((t - la - 0.15) / 0.45, 0), 1), 3);

  return (
    <div className="rounded-[2.4rem] bg-gradient-to-b from-white/15 to-white/5 p-2.5 shadow-2xl shadow-black/60">
      <div className="relative overflow-hidden rounded-[2rem] bg-black" style={{ width, height: (width * H) / W }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${width / W})` }}>
          <div className="absolute left-0 overflow-hidden" style={{ top: fullscreen ? 0 : BANNER_H, width: W, height: fullscreen ? H : H - BANNER_H }}>
            {scene && (
              <FootageView key={scene.id} f={f} url={url} index={i} local={local} dur={b - a} playing={playing} motion={scene.motion ?? "auto"} fit={scene.fit ?? "fill"} />
            )}
          </div>

          <div className={`absolute top-0 left-0 place-items-center bg-black ${fullscreen ? "hidden" : "grid"}`} style={{ width: W, height: BANNER_H }}>
            <div className="pb-2.5 text-center">
              {titleLines.map((l, k) => (
                <Outlined key={k} text={l} size={titleSize} />
              ))}
              {!title && <span className="font-sans text-[48px] text-white/25">Your title</span>}
            </div>
            <div className="absolute bottom-0 left-0 h-2.5 w-full" style={{ background: "linear-gradient(90deg, rgb(25,65,227), rgb(75,181,255))" }} />
          </div>

          {s.ranking &&
            scene?.show_ranks !== false &&
            Array.from({ length: n }, (_, k) => k + 1).map((rank, k) => {
              const shown = revealed.has(rank);
              const name = shown ? ranks.get(rank) || `Rank ${rank}` : "?";
              const gold = rank === 1 && shown;
              const current = rank === scene?.rank;
              const size = fit(`#${rank}  ${name}`, 700, ROW_FONT, 26, 0);
              const bg = gold ? GOLD : current ? ACCENT : "rgba(0,0,0,0.59)";
              const fg = gold ? "#000" : "#fff";
              return (
                <div
                  key={rank}
                  className="absolute flex items-center whitespace-nowrap"
                  style={{
                    left: LIST_X,
                    top: LIST_TOP + k * ROW_H + ROW_H * 0.08,
                    height: ROW_H * 0.84,
                    padding: "0 22px",
                    borderRadius: ROW_H * 0.3,
                    background: bg,
                    fontFamily: "var(--font-title)",
                    fontSize: size,
                  }}
                >
                  <span className={gold ? "" : "stroke-text"} style={{ color: gold || current ? fg : (MEDALS[rank] ?? "#fff"), WebkitTextStrokeWidth: gold ? 0 : 6 }}>
                    #{rank}
                  </span>
                  <span className={gold ? "" : "stroke-text"} style={{ color: name === "?" ? "#C9C9D1" : fg, WebkitTextStrokeWidth: gold ? 0 : 6 }}>
                    &nbsp;&nbsp;{name}
                  </span>
                </div>
              );
            })}

          {label && (
            <div className="absolute left-0 flex w-full justify-center" style={{ top: LABEL_CY, transform: `translate(${slide * W}px, -50%)` }}>
              <div className="rounded-[34px] text-center" style={{ background: ACCENT, border: "5px solid rgba(255,255,255,0.9)", padding: "26px 44px" }}>
                {labelLines.map((l, k) => (
                  <Outlined key={k} text={l} size={labelSize} ratio={0.07} />
                ))}
              </div>
            </div>
          )}

          {cue && (
            <div className="absolute left-0 flex w-full flex-col items-center" style={{ top: CAPTION_CY, transform: "translateY(-50%)" }}>
              {capLines.map((l, k) => (
                <Outlined key={k} text={l} size={capSize} ratio={0.11} />
              ))}
            </div>
          )}

          {i > 0 && local < FLASH && <div className="absolute inset-0 bg-white" style={{ opacity: 0.7 * (1 - local / FLASH) }} />}
        </div>
      </div>
    </div>
  );
}
