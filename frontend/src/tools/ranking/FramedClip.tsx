import type { ReactNode } from "react";
import { AREA_H, cropBox, W } from "./layout";
import type { Slot } from "./types";

type Box = { left: number; top: number; width: number; height: number };
const px = (b: Box) => ({
  left: b.left,
  top: b.top,
  width: b.width,
  height: b.height,
});

/**
 * A clip framed like the rendered video (crop, fill / fit + blur), drawn in video pixels
 * (W x AREA_H). Scale the parent to show it smaller. `media` draws the clip (a <video> or <img>)
 * into the box it's given.
 */
export default function FramedClip({
  slot,
  fit,
  media,
}: {
  slot: Slot;
  fit: "fit" | "fill";
  media: (style: Box, background?: boolean) => ReactNode;
}) {
  const box = cropBox(slot, fit);
  const cover = cropBox(slot, "fill");
  return (
    <div
      className="relative overflow-hidden bg-black"
      style={{ width: W, height: AREA_H }}
    >
      {fit === "fit" && (
        <div className="absolute inset-0 scale-110 blur-[40px] brightness-[0.8]">
          {media(px(cover.video), true)}
        </div>
      )}
      <div className="absolute overflow-hidden" style={px(box.window)}>
        {media(px(box.video))}
      </div>
    </div>
  );
}
