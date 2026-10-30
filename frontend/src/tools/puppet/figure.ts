/** The puppet: its parts, built-in characters, and drawing a pose.
 *  drawFigure's joint maths matches backend/app/tools/puppet/render.py. */
export const W = 1080;
export const H = 1920;
export const GROUND = 0.82;
export const FW = 400; // figure units; part canvases hold 2 pixels per unit
export const FH = 800;
const PX = 2;
const FEET: Point = [200, 780];
const HIP: Point = [200, 470];
const SIDE_SHOULDER: Point = [200, 245];
const FAR = 0.8; // far-side limbs are this much darker
const TOLERANCE = 12; // how close (r+g+b difference) counts as the same colour

export type Point = [number, number];
export type Rgb = [number, number, number];
type BasePart = "hair" | "head" | "torso" | "armL" | "armR" | "legL" | "legR";
type Carrier = "head" | "torso" | "armR"; // the parts attachments ride on
export type View = "front" | "side";
type ExtraId = `${Carrier}_extra` | `${Carrier}_side_extra`;
export type PartId = BasePart | `${BasePart}_side` | ExtraId;
export type Layers = Record<PartId, HTMLCanvasElement>;

export const PARTS: {
  id: PartId;
  base: BasePart;
  view: View;
  label: string;
  joint: Point;
  zone: [number, number, number, number]; // x, y, w, h of where to draw it
}[] = [
  {
    id: "hair",
    base: "hair",
    view: "front",
    label: "Hair",
    joint: [200, 215],
    zone: [90, 30, 220, 280],
  },
  {
    id: "head",
    base: "head",
    view: "front",
    label: "Head",
    joint: [200, 215],
    zone: [100, 30, 200, 195],
  },
  {
    id: "torso",
    base: "torso",
    view: "front",
    label: "Body",
    joint: HIP,
    zone: [120, 200, 160, 300],
  },
  {
    id: "armL",
    base: "armL",
    view: "front",
    label: "Left arm",
    joint: [150, 245],
    zone: [50, 225, 115, 280],
  },
  {
    id: "armR",
    base: "armR",
    view: "front",
    label: "Right arm",
    joint: [250, 245],
    zone: [235, 225, 115, 280],
  },
  {
    id: "legL",
    base: "legL",
    view: "front",
    label: "Left leg",
    joint: [170, 470],
    zone: [120, 460, 80, 325],
  },
  {
    id: "legR",
    base: "legR",
    view: "front",
    label: "Right leg",
    joint: [230, 470],
    zone: [200, 460, 80, 325],
  },
  {
    id: "hair_side",
    base: "hair",
    view: "side",
    label: "Hair",
    joint: [200, 215],
    zone: [90, 30, 220, 280],
  },
  {
    id: "head_side",
    base: "head",
    view: "side",
    label: "Head",
    joint: [200, 215],
    zone: [100, 30, 200, 195],
  },
  {
    id: "torso_side",
    base: "torso",
    view: "side",
    label: "Body",
    joint: HIP,
    zone: [130, 200, 140, 300],
  },
  {
    id: "armL_side",
    base: "armL",
    view: "side",
    label: "Far arm",
    joint: SIDE_SHOULDER,
    zone: [150, 225, 100, 280],
  },
  {
    id: "armR_side",
    base: "armR",
    view: "side",
    label: "Near arm",
    joint: SIDE_SHOULDER,
    zone: [150, 225, 100, 280],
  },
  {
    id: "legL_side",
    base: "legL",
    view: "side",
    label: "Far leg",
    joint: HIP,
    zone: [150, 460, 120, 325],
  },
  {
    id: "legR_side",
    base: "legR",
    view: "side",
    label: "Near leg",
    joint: HIP,
    zone: [150, 460, 120, 325],
  },
];

const ORDER: Record<View, BasePart[]> = {
  front: ["hair", "legL", "legR", "torso", "armL", "armR", "head"],
  side: ["hair", "armL", "legL", "legR", "torso", "armR", "head"],
};

export const EXTRAS: ExtraId[] = [
  "head_extra",
  "torso_extra",
  "armR_extra",
  "head_side_extra",
  "torso_side_extra",
  "armR_side_extra",
];

export function makeLayers(): Layers {
  const one = () => {
    const c = document.createElement("canvas");
    c.width = FW * PX;
    c.height = FH * PX;
    return c;
  };
  const ids = [...PARTS.map((p) => p.id), ...EXTRAS];
  return Object.fromEntries(ids.map((id) => [id, one()])) as Layers;
}

/** The topmost part with ink at a point on the board, and the colour there. */
export function partAt(
  layers: Layers,
  view: View,
  [x, y]: Point,
): { id: PartId; rgb: Rgb } | null {
  for (const base of [...ORDER[view]].reverse()) {
    const id = (view === "front" ? base : `${base}_side`) as PartId;
    const [r, g, b, a] = layers[id]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(x * PX, y * PX, 1, 1).data;
    if (a > 40) return { id, rgb: [r, g, b] };
  }
  return null;
}

/** The same body part in the other view. */
export function twin(id: PartId): PartId {
  const { base, view } = PARTS.find((p) => p.id === id)!;
  return PARTS.find((p) => p.base === base && p.view !== view)!.id;
}

/** The colour that covers most of a part, or null if it's blank. */
export function mainColour(layers: Layers, id: PartId): Rgb | null {
  const c = layers[id];
  const { data } = c
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, c.width, c.height);
  const seen = new Map<number, number>();
  let best: number | null = null;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] < 200) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (best === null || n > seen.get(best)!) best = key;
  }
  return best === null ? null : [best >> 16, (best >> 8) & 255, best & 255];
}

export const HAIR_PARTS: PartId[] = ["hair", "hair_side", "head", "head_side"];

export function sameColour(a: Rgb, b: Rgb) {
  return (
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <=
    TOLERANCE
  );
}

/** The hair colour: from the long hair if there is any, else the top of the head (short hair is
 *  part of the head drawing). Null when the head is bald. */
export function hairColour(layers: Layers): Rgb | null {
  const long = mainColour(layers, "hair") ?? mainColour(layers, "hair_side");
  if (long) return long;
  const [r, g, b, a] = layers.head
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(200 * PX, 50 * PX, 1, 1).data;
  const skin = mainColour(layers, "head");
  return a > 200 && skin && !sameColour([r, g, b], skin) ? [r, g, b] : null;
}

/** Change one colour on the given parts. The darker copy on far-side limbs changes with it.
 *  Returns what the changed parts looked like before. */
export function recolour(layers: Layers, ids: PartId[], from: Rgb, to: Rgb) {
  const times = (c: Rgb, k: number): Rgb => [
    Math.min(c[0] * k, 255),
    Math.min(c[1] * k, 255),
    Math.min(c[2] * k, 255),
  ];
  const swaps: [Rgb, Rgb][] = [
    [from, to],
    [times(from, FAR), times(to, FAR)],
    [times(from, 1 / FAR), to], // clicked on a far-side limb: this is its near-side colour
  ];
  const before: { id: PartId; data: ImageData }[] = [];
  for (const id of ids) {
    const c = layers[id];
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const image = ctx.getImageData(0, 0, c.width, c.height);
    const d = image.data;
    let changed = false;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      for (const [a, b] of swaps) {
        if (!sameColour([d[i], d[i + 1], d[i + 2]], a)) continue;
        if (!changed)
          before.push({
            id,
            data: new ImageData(d.slice(), c.width, c.height),
          });
        changed = true;
        [d[i], d[i + 1], d[i + 2]] = b;
        break;
      }
    }
    if (changed) ctx.putImageData(image, 0, 0);
  }
  return before;
}

/** The side parts that have something drawn on them; the rest borrow the front art. */
export function sideArt(layers: Layers): Set<PartId> {
  const inked = PARTS.filter(({ id, view }) => {
    if (view !== "side") return false;
    const c = layers[id];
    const { data } = c
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, c.width, c.height);
    return data.some((v, i) => i % 4 === 3 && v > 0);
  });
  return new Set(inked.map((p) => p.id));
}

/** A context for a part canvas that works in figure units. */
export function partContext(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(PX, 0, 0, PX, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

const JOINTS = ["y", "root", "body", "head", "armL", "armR", "legL", "legR"];

/** One timeline row: [x, width, side, ...JOINTS]. `ctx` works in 1080x1920 frame pixels. */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  row: number[],
  scale: number,
  sides: Set<PartId>,
) {
  const pose = Object.fromEntries(JOINTS.map((j, i) => [j, row[i + 3]]));
  const view: View = row[2] ? "side" : "front";
  const rot = (deg: number, [x, y]: Point) => {
    ctx.translate(x, y);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.translate(-x, -y);
  };
  const place = (id: PartId) => ctx.drawImage(layers[id], 0, 0, FW, FH);
  const joint = (id: BasePart, v: View) =>
    PARTS.find((p) => p.base === id && p.view === v)!.joint;

  ctx.save();
  ctx.translate(row[0] * W, GROUND * H);
  ctx.scale(scale * row[1], scale);
  ctx.translate(-FEET[0], -FEET[1] + pose.y);
  rot(pose.root, FEET);
  for (const id of ORDER[view]) {
    ctx.save();
    if (id === "legL" || id === "legR") {
      rot(pose[id], joint(id, view));
    } else {
      rot(pose.body, HIP);
      if (id !== "torso")
        rot(pose[id === "hair" ? "head" : id], joint(id, view));
    }
    const side = `${id}_side` as PartId;
    const art = view === "side" && sides.has(side) ? side : id;
    ctx.save();
    if (view === "side" && art === id && id !== "torso")
      ctx.translate(joint(id, "side")[0] - joint(id, "front")[0], 0);
    place(art);
    ctx.restore();
    const extra = `${view === "front" ? id : side}_extra` as PartId;
    if (extra in layers) place(extra);
    ctx.restore();
  }
  ctx.restore();
}

export type Character = {
  id: string;
  label: string;
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  style: "short" | "long" | "bun" | "bald";
  dress?: boolean;
  stick?: boolean;
};

export const CHARACTERS: Character[] = [
  {
    id: "stick",
    label: "Stick figure",
    skin: "#FFFFFF",
    hair: "#111111",
    top: "#111111",
    bottom: "#111111",
    style: "bald",
    stick: true,
  },
  {
    id: "girl",
    label: "Girl",
    skin: "#E8B48C",
    hair: "#2B1B12",
    top: "#E8467C",
    bottom: "#3B4CC0",
    style: "long",
  },
  {
    id: "boy",
    label: "Boy",
    skin: "#D9A077",
    hair: "#1E1410",
    top: "#2F9E6E",
    bottom: "#33415C",
    style: "short",
  },
  {
    id: "mother",
    label: "Mother",
    skin: "#D9A077",
    hair: "#1E1410",
    top: "#C2274B",
    bottom: "#C2274B",
    style: "bun",
    dress: true,
  },
  {
    id: "father",
    label: "Father",
    skin: "#C68E63",
    hair: "#2B1B12",
    top: "#3A6EA5",
    bottom: "#2B2D42",
    style: "short",
  },
  {
    id: "grandma",
    label: "Grandma",
    skin: "#E0B08C",
    hair: "#C9C9CF",
    top: "#7A5BA6",
    bottom: "#7A5BA6",
    style: "bun",
    dress: true,
  },
];

function line(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  points: Point[],
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

/** The same colour, darker: limbs on the far side of the body. */
function shade(hex: string) {
  const dim = (at: number) =>
    Math.round(parseInt(hex.slice(at, at + 2), 16) * FAR)
      .toString(16)
      .padStart(2, "0");
  return `#${dim(1)}${dim(3)}${dim(5)}`;
}

function box(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 8,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function shape(ctx: CanvasRenderingContext2D, color: string, points: Point[]) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function circle(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  r: number,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintHead(ctx: CanvasRenderingContext2D, c: Character) {
  const [x, y, r] = [200, 125, 82];
  if (c.style === "bun") circle(ctx, c.hair, x, y - r - 12, 34);
  line(ctx, c.skin, 40, [
    [200, 190],
    [200, 228],
  ]);
  circle(ctx, c.skin, x, y, r);
  if (c.stick) {
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (c.style !== "bald") {
    ctx.fillStyle = c.hair;
    ctx.beginPath();
    ctx.arc(x, y - 6, r + 4, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(x + 10, y - 62, x - r - 3, y - 2);
    ctx.fill();
  }
  circle(ctx, "#1A1A1A", x - 30, y + 8, 8);
  circle(ctx, "#1A1A1A", x + 30, y + 8, 8);
  ctx.strokeStyle = "#7A3B2E";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y + 26, 24, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
}

/** The head in profile, looking right. */
function paintHeadSide(ctx: CanvasRenderingContext2D, c: Character) {
  const [x, y, r] = [200, 125, 82];
  if (c.style === "bun") circle(ctx, c.hair, x - r - 8, y - 30, 34);
  line(ctx, c.skin, 40, [
    [196, 190],
    [196, 228],
  ]);
  circle(ctx, c.skin, x, y, r);
  shape(ctx, c.skin, [
    [x + r - 6, y - 6],
    [x + r + 16, y + 18],
    [x + r - 8, y + 24],
  ]);
  if (c.stick) {
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (c.style !== "bald") {
    ctx.fillStyle = c.hair;
    ctx.beginPath();
    ctx.arc(x, y - 6, r + 4, Math.PI * 0.72, Math.PI * 1.92);
    ctx.quadraticCurveTo(x + 8, y - 50, x - 22, y + 2);
    ctx.quadraticCurveTo(x - 30, y + 50, x - 62, y + 58);
    ctx.fill();
  }
  circle(ctx, "#1A1A1A", x + 44, y + 6, 8);
  ctx.strokeStyle = "#7A3B2E";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x + 30, y + 44);
  ctx.quadraticCurveTo(x + 46, y + 52, x + 62, y + 40);
  ctx.stroke();
}

function paintSidePart(
  ctx: CanvasRenderingContext2D,
  base: BasePart,
  c: Character,
) {
  if (base === "head") return paintHeadSide(ctx, c);
  if (base === "hair") {
    if (c.style === "long") box(ctx, c.hair, 106, 35, 132, 259, 60);
    return;
  }
  const far = base === "armL" || base === "legL";
  const tint = (color: string) => (far && !c.stick ? shade(color) : color);
  if (c.stick) {
    if (base === "torso")
      line(ctx, c.top, 12, [
        [200, 215],
        [200, 470],
      ]);
    else if (base.startsWith("arm"))
      line(ctx, c.top, 12, [
        [200, 245],
        [206, 470],
      ]);
    else
      line(ctx, c.top, 12, [
        [200, 470],
        [200, 775],
      ]);
    return;
  }
  if (base === "torso") {
    if (c.dress)
      shape(ctx, c.top, [
        [160, 215],
        [240, 215],
        [272, 640],
        [128, 640],
      ]);
    else box(ctx, c.top, 150, 212, 100, 280, 34);
  } else if (base.startsWith("arm")) {
    line(ctx, tint(c.top), 42, [
      [200, 245],
      [203, 400],
    ]);
    line(ctx, tint(c.skin), 34, [
      [203, 400],
      [205, 462],
    ]);
    circle(ctx, tint(c.skin), 206, 472, 21);
  } else {
    line(ctx, tint(c.dress ? c.skin : c.bottom), 54, [
      [200, 470],
      [200, 745],
    ]);
    box(ctx, tint("#2A2230"), 172, 738, 90, 40, 16);
  }
}

/** Replace every part with a ready-made character, to draw on top of. */
export function paintCharacter(layers: Layers, c: Character) {
  for (const p of PARTS) {
    const ctx = partContext(layers[p.id]);
    ctx.clearRect(0, 0, FW, FH);
    if (p.view === "side") {
      paintSidePart(ctx, p.base, c);
      continue;
    }
    if (p.id === "head") paintHead(ctx, c);
    if (p.id === "hair" && c.style === "long")
      box(ctx, c.hair, 108, 35, 184, 239, 70);
    const arm = p.id === "armL" ? -1 : 1;
    const leg = p.id === "legL" ? -1 : 1;
    if (c.stick) {
      if (p.id === "torso")
        line(ctx, c.top, 12, [
          [200, 215],
          [200, 470],
        ]);
      if (p.id === "armL" || p.id === "armR")
        line(ctx, c.top, 12, [
          [200 + 50 * arm, 245],
          [200 + 85 * arm, 470],
        ]);
      if (p.id === "legL" || p.id === "legR")
        line(ctx, c.top, 12, [
          [200 + 30 * leg, 470],
          [200 + 34 * leg, 775],
        ]);
      continue;
    }
    if (p.id === "torso") {
      ctx.fillStyle = c.top;
      ctx.beginPath();
      if (c.dress) {
        ctx.moveTo(150, 215);
        ctx.lineTo(250, 215);
        ctx.lineTo(300, 640);
        ctx.lineTo(100, 640);
        ctx.closePath();
      } else ctx.roundRect(130, 212, 140, 280, 34);
      ctx.fill();
    }
    if (p.id === "armL" || p.id === "armR") {
      line(ctx, c.top, 42, [
        [200 + 50 * arm, 245],
        [200 + 82 * arm, 400],
      ]);
      line(ctx, c.skin, 34, [
        [200 + 82 * arm, 400],
        [200 + 90 * arm, 462],
      ]);
      circle(ctx, c.skin, 200 + 91 * arm, 472, 21);
    }
    if (p.id === "legL" || p.id === "legR") {
      line(ctx, c.dress ? c.skin : c.bottom, 54, [
        [200 + 30 * leg, 470],
        [200 + 32 * leg, 745],
      ]);
      ctx.fillStyle = "#2A2230";
      ctx.beginPath();
      ctx.roundRect(200 + 32 * leg - 34 + 8 * leg, 738, 68, 40, 16);
      ctx.fill();
    }
  }
}

type Accessory = {
  id: string;
  label: string;
  on: Carrier;
  draw: (ctx: CanvasRenderingContext2D, side: boolean) => void;
};

const hand = (side: boolean): Point => [side ? 206 : 291, 472];

function hat(
  ctx: CanvasRenderingContext2D,
  color: string,
  y: number,
  r: number,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(200, y, r, Math.PI, 0);
  ctx.fill();
}

function glasses(
  ctx: CanvasRenderingContext2D,
  side: boolean,
  fill: string | null,
) {
  const lens = (x: number) => {
    if (fill) circle(ctx, fill, x, 133, 24);
    ctx.strokeStyle = "#1A1A1A";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x, 133, 24, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (side) {
    line(ctx, "#1A1A1A", 6, [
      [222, 130],
      [150, 118],
    ]);
    lens(244);
    return;
  }
  lens(170);
  lens(230);
  line(ctx, "#1A1A1A", 6, [
    [194, 130],
    [206, 130],
  ]);
}

/** Attachments by slot: one per slot, each drawn for the front and the side view. */
export const ACCESSORIES: {
  slot: string;
  label: string;
  items: Accessory[];
}[] = [
  {
    slot: "hat",
    label: "Hat",
    items: [
      {
        id: "cap",
        label: "Cap",
        on: "head",
        draw(ctx, side) {
          hat(ctx, "#2F5FB3", 104, 88);
          box(ctx, "#234A8E", side ? 200 : 106, 96, side ? 128 : 188, 18);
        },
      },
      {
        id: "tophat",
        label: "Top hat",
        on: "head",
        draw(ctx) {
          box(ctx, "#1C1C22", 138, 4, 124, 62, 6);
          box(ctx, "#B3263C", 138, 46, 124, 14, 0);
          box(ctx, "#1C1C22", 100, 60, 200, 16);
        },
      },
      {
        id: "sunhat",
        label: "Sun hat",
        on: "head",
        draw(ctx) {
          ctx.fillStyle = "#E7C77B";
          ctx.beginPath();
          ctx.ellipse(200, 72, 140, 20, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(200, 70, 78, 62, 0, Math.PI, 0);
          ctx.fill();
          box(ctx, "#C2274B", 122, 54, 156, 16, 0);
        },
      },
      {
        id: "beanie",
        label: "Woolly hat",
        on: "head",
        draw(ctx) {
          hat(ctx, "#C2533B", 100, 88);
          box(ctx, "#9E3E2B", 106, 86, 188, 30, 12);
        },
      },
      {
        id: "crown",
        label: "Crown",
        on: "head",
        draw(ctx) {
          shape(ctx, "#F2C230", [
            [132, 66],
            [122, 12],
            [162, 40],
            [200, 4],
            [238, 40],
            [278, 12],
            [268, 66],
          ]);
          circle(ctx, "#C2274B", 200, 50, 9);
        },
      },
      {
        id: "bow",
        label: "Hair bow",
        on: "head",
        draw(ctx, side) {
          const x = side ? 172 : 148;
          shape(ctx, "#E8467C", [
            [x, 58],
            [x - 38, 34],
            [x - 38, 82],
          ]);
          shape(ctx, "#E8467C", [
            [x, 58],
            [x + 38, 34],
            [x + 38, 82],
          ]);
          circle(ctx, "#B3265A", x, 58, 11);
        },
      },
    ],
  },
  {
    slot: "eyes",
    label: "Glasses",
    items: [
      {
        id: "glasses",
        label: "Glasses",
        on: "head",
        draw: (ctx, side) => glasses(ctx, side, null),
      },
      {
        id: "sunglasses",
        label: "Sunglasses",
        on: "head",
        draw: (ctx, side) => glasses(ctx, side, "#1A1A1A"),
      },
    ],
  },
  {
    slot: "face",
    label: "Face",
    items: [
      {
        id: "moustache",
        label: "Moustache",
        on: "head",
        draw(ctx, side) {
          ctx.fillStyle = "#2B1B12";
          ctx.beginPath();
          if (side) ctx.ellipse(252, 156, 28, 9, 0, 0, Math.PI * 2);
          else {
            ctx.ellipse(176, 156, 26, 9, -0.2, 0, Math.PI * 2);
            ctx.ellipse(224, 156, 26, 9, 0.2, 0, Math.PI * 2);
          }
          ctx.fill();
        },
      },
      {
        id: "beard",
        label: "Beard",
        on: "head",
        draw(ctx, side) {
          ctx.fillStyle = "#2B1B12";
          ctx.beginPath();
          if (side) {
            ctx.arc(200, 125, 92, 0.06 * Math.PI, 0.62 * Math.PI);
            ctx.quadraticCurveTo(232, 190, 286, 158);
          } else {
            ctx.arc(200, 125, 92, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.quadraticCurveTo(200, 222, 288, 153);
          }
          ctx.fill();
        },
      },
    ],
  },
  {
    slot: "neck",
    label: "Neck",
    items: [
      {
        id: "tie",
        label: "Tie",
        on: "torso",
        draw(ctx, side) {
          const x = side ? 240 : 200;
          shape(ctx, "#B3263C", [
            [x - 12, 222],
            [x + 12, 222],
            [x + 5, 244],
            [x + 16, 350],
            [x, 372],
            [x - 16, 350],
            [x - 5, 244],
          ]);
        },
      },
      {
        id: "bowtie",
        label: "Bow tie",
        on: "torso",
        draw(ctx, side) {
          const x = side ? 234 : 200;
          shape(ctx, "#B3263C", [
            [x, 234],
            [x - 32, 216],
            [x - 32, 252],
          ]);
          shape(ctx, "#B3263C", [
            [x, 234],
            [x + 32, 216],
            [x + 32, 252],
          ]);
          circle(ctx, "#7E1A2B", x, 234, 9);
        },
      },
      {
        id: "scarf",
        label: "Scarf",
        on: "torso",
        draw(ctx, side) {
          box(ctx, "#E2A32C", side ? 146 : 134, 206, side ? 108 : 132, 36, 16);
          box(ctx, "#C98A1A", side ? 150 : 222, 232, 32, 120, 8);
        },
      },
      {
        id: "necklace",
        label: "Necklace",
        on: "torso",
        draw(ctx, side) {
          ctx.strokeStyle = "#F2C230";
          ctx.lineWidth = 6;
          ctx.beginPath();
          if (side) {
            ctx.moveTo(206, 216);
            ctx.quadraticCurveTo(216, 270, 240, 276);
          } else ctx.arc(200, 214, 56, 0.12 * Math.PI, 0.88 * Math.PI);
          ctx.stroke();
          circle(ctx, "#E8467C", side ? 240 : 200, side ? 282 : 276, 11);
        },
      },
    ],
  },
  {
    slot: "back",
    label: "Back",
    items: [
      {
        id: "backpack",
        label: "Backpack",
        on: "torso",
        draw(ctx, side) {
          if (side) box(ctx, "#2F9E6E", 76, 236, 84, 180, 22);
          line(
            ctx,
            "#1F7A52",
            18,
            side
              ? [
                  [190, 218],
                  [152, 400],
                ]
              : [
                  [160, 218],
                  [160, 400],
                ],
          );
          if (!side)
            line(ctx, "#1F7A52", 18, [
              [240, 218],
              [240, 400],
            ]);
        },
      },
    ],
  },
  {
    slot: "hand",
    label: "In hand",
    items: [
      {
        id: "stick",
        label: "Walking stick",
        on: "armR",
        draw(ctx, side) {
          const [x, y] = hand(side);
          ctx.strokeStyle = "#6B4426";
          ctx.lineWidth = 13;
          ctx.beginPath();
          ctx.arc(x + 22, y - 8, 22, Math.PI, 0);
          ctx.stroke();
          line(ctx, "#6B4426", 13, [
            [x, y - 8],
            [x, 776],
          ]);
        },
      },
      {
        id: "bag",
        label: "Handbag",
        on: "armR",
        draw(ctx, side) {
          const [x, y] = hand(side);
          ctx.strokeStyle = "#7A3B2E";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.arc(x, y + 42, 32, Math.PI, 0);
          ctx.stroke();
          box(ctx, "#A5553F", x - 50, y + 40, 100, 78, 12);
        },
      },
      {
        id: "lantern",
        label: "Lantern",
        on: "armR",
        draw(ctx, side) {
          const [x, y] = hand(side);
          line(ctx, "#3A3A42", 7, [
            [x, y],
            [x, y + 34],
          ]);
          circle(ctx, "#FFD76A55", x, y + 80, 74);
          box(ctx, "#3A3A42", x - 26, y + 32, 52, 12, 4);
          box(ctx, "#FFD76A", x - 21, y + 44, 42, 68, 6);
          box(ctx, "#3A3A42", x - 26, y + 110, 52, 12, 4);
        },
      },
    ],
  },
];

/** Redraw the attachment layers from the slot -> item choices. */
export function paintAccessories(
  layers: Layers,
  chosen: Record<string, string>,
) {
  for (const id of EXTRAS) partContext(layers[id]).clearRect(0, 0, FW, FH);
  for (const { slot, items } of ACCESSORIES) {
    const item = items.find((i) => i.id === chosen[slot]);
    if (!item) continue;
    item.draw(partContext(layers[`${item.on}_extra`]), false);
    item.draw(partContext(layers[`${item.on}_side_extra`]), true);
  }
}

export type PropArt = {
  kind: string;
  label: string;
  y: number; // where it first stands: on the ground, or up in the sky
  scale: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
};

export const PROP_SIZE = 400; // scene items are drawn in 400x400 units, standing on the bottom edge

/** Scene items, drawn by the editor and sent to the server as pictures for the render. */
export const PROPS: PropArt[] = [
  {
    kind: "house",
    label: "House",
    y: GROUND,
    scale: 2,
    draw(ctx) {
      box(ctx, "#E9D5B0", 70, 170, 260, 228, 4);
      shape(ctx, "#B3453A", [
        [40, 180],
        [200, 50],
        [360, 180],
      ]);
      box(ctx, "#7A4A2B", 170, 280, 64, 118, 6);
      circle(ctx, "#F2C230", 222, 342, 5);
      box(ctx, "#8FC8E8", 92, 214, 56, 56, 4);
      box(ctx, "#8FC8E8", 256, 214, 56, 56, 4);
      box(ctx, "#8A4B3A", 270, 74, 34, 70, 2);
    },
  },
  {
    kind: "tree",
    label: "Tree",
    y: GROUND,
    scale: 2.2,
    draw(ctx) {
      box(ctx, "#6B4426", 176, 220, 48, 180, 8);
      circle(ctx, "#3F8F4F", 200, 130, 96);
      circle(ctx, "#4AA35C", 130, 170, 70);
      circle(ctx, "#4AA35C", 270, 170, 70);
    },
  },
  {
    kind: "pine",
    label: "Pine tree",
    y: GROUND,
    scale: 2.2,
    draw(ctx) {
      box(ctx, "#5C3B22", 182, 330, 36, 70, 4);
      for (const [top, half] of [
        [10, 70],
        [90, 100],
        [180, 130],
      ])
        shape(ctx, "#2C6E49", [
          [200, top],
          [200 + half, top + 160],
          [200 - half, top + 160],
        ]);
    },
  },
  {
    kind: "bush",
    label: "Bush",
    y: GROUND,
    scale: 1,
    draw(ctx) {
      circle(ctx, "#3F8F4F", 200, 300, 100);
      circle(ctx, "#4AA35C", 110, 340, 62);
      circle(ctx, "#4AA35C", 290, 340, 62);
      box(ctx, "#4AA35C", 60, 360, 280, 40, 4);
    },
  },
  {
    kind: "flowers",
    label: "Flowers",
    y: GROUND,
    scale: 0.7,
    draw(ctx) {
      [
        [90, 250, "#E8467C"],
        [200, 200, "#F2C230"],
        [310, 250, "#7A5BA6"],
      ].forEach(([x, y, color]) => {
        const [fx, fy] = [x as number, y as number];
        line(ctx, "#3F8F4F", 12, [
          [fx, fy],
          [fx, 398],
        ]);
        for (let a = 0; a < 5; a++)
          circle(
            ctx,
            color as string,
            fx + 30 * Math.cos((a * 2 * Math.PI) / 5),
            fy + 30 * Math.sin((a * 2 * Math.PI) / 5),
            24,
          );
        circle(ctx, "#FFF2B0", fx, fy, 18);
      });
    },
  },
  {
    kind: "fence",
    label: "Fence",
    y: GROUND,
    scale: 1.3,
    draw(ctx) {
      box(ctx, "#C9A26B", 0, 280, 400, 22, 2);
      box(ctx, "#C9A26B", 0, 340, 400, 22, 2);
      for (const x of [14, 104, 194, 284, 366])
        shape(ctx, "#D9B680", [
          [x, 240],
          [x + 12, 222],
          [x + 24, 240],
          [x + 24, 398],
          [x, 398],
        ]);
    },
  },
  {
    kind: "rock",
    label: "Rock",
    y: GROUND,
    scale: 0.8,
    draw(ctx) {
      shape(ctx, "#8B8F96", [
        [50, 398],
        [90, 280],
        [190, 220],
        [300, 260],
        [355, 398],
      ]);
      shape(ctx, "#A5A9B0", [
        [120, 300],
        [190, 240],
        [240, 270],
        [170, 330],
      ]);
    },
  },
  {
    kind: "bench",
    label: "Bench",
    y: GROUND,
    scale: 1.1,
    draw(ctx) {
      box(ctx, "#8A5A34", 40, 200, 320, 22, 4);
      box(ctx, "#8A5A34", 40, 240, 320, 22, 4);
      box(ctx, "#A06B40", 30, 296, 340, 26, 4);
      box(ctx, "#3A3A42", 66, 200, 18, 198, 2);
      box(ctx, "#3A3A42", 316, 200, 18, 198, 2);
    },
  },
  {
    kind: "lamp",
    label: "Street lamp",
    y: GROUND,
    scale: 2.2,
    draw(ctx) {
      box(ctx, "#2E3138", 192, 60, 16, 340, 4);
      box(ctx, "#2E3138", 166, 382, 68, 18, 4);
      circle(ctx, "#FFD76A55", 200, 56, 62);
      circle(ctx, "#FFD76A", 200, 56, 30);
      box(ctx, "#2E3138", 164, 18, 72, 12, 4);
    },
  },
  {
    kind: "car",
    label: "Car",
    y: GROUND,
    scale: 1.8,
    draw(ctx) {
      box(ctx, "#C2274B", 16, 256, 368, 104, 28);
      shape(ctx, "#C2274B", [
        [90, 264],
        [136, 180],
        [270, 180],
        [324, 264],
      ]);
      shape(ctx, "#BFE3F5", [
        [118, 256],
        [146, 196],
        [196, 196],
        [196, 256],
      ]);
      shape(ctx, "#BFE3F5", [
        [210, 196],
        [262, 196],
        [298, 256],
        [210, 256],
      ]);
      for (const x of [100, 300]) {
        circle(ctx, "#1C1C22", x, 354, 44);
        circle(ctx, "#C9C9CF", x, 354, 18);
      }
    },
  },
  {
    kind: "grave",
    label: "Gravestone",
    y: GROUND,
    scale: 0.9,
    draw(ctx) {
      box(ctx, "#8B8F96", 100, 120, 200, 400, 90);
      line(ctx, "#6A6E75", 12, [
        [200, 180],
        [200, 300],
      ]);
      line(ctx, "#6A6E75", 12, [
        [160, 220],
        [240, 220],
      ]);
    },
  },
  {
    kind: "cloud",
    label: "Cloud",
    y: 0.3,
    scale: 1.3,
    draw(ctx) {
      circle(ctx, "#FFFFFF", 200, 260, 84);
      circle(ctx, "#FFFFFF", 110, 310, 62);
      circle(ctx, "#FFFFFF", 300, 306, 68);
      box(ctx, "#FFFFFF", 60, 310, 300, 62, 30);
    },
  },
  {
    kind: "sun",
    label: "Sun",
    y: 0.25,
    scale: 1,
    draw(ctx) {
      for (let a = 0; a < 12; a++) {
        const t = (a * Math.PI) / 6;
        line(ctx, "#F2A33A", 14, [
          [200 + 110 * Math.cos(t), 200 + 110 * Math.sin(t)],
          [200 + 170 * Math.cos(t), 200 + 170 * Math.sin(t)],
        ]);
      }
      circle(ctx, "#F9CF3A", 200, 200, 92);
    },
  },
  {
    kind: "moon",
    label: "Moon",
    y: 0.25,
    scale: 1,
    draw(ctx) {
      ctx.fillStyle = "#F3EBC8";
      ctx.beginPath();
      ctx.arc(200, 200, 130, 0.35 * Math.PI, 1.65 * Math.PI);
      ctx.quadraticCurveTo(
        120,
        200,
        200 + 130 * Math.cos(0.35 * Math.PI),
        200 + 130 * Math.sin(0.35 * Math.PI),
      );
      ctx.fill();
    },
  },
];

const propArt = new Map<string, HTMLCanvasElement>();

/** A scene item's picture, or nothing for a kind this version doesn't have. */
export function propCanvas(kind: string): HTMLCanvasElement | null {
  const art = PROPS.find((p) => p.kind === kind);
  if (!art) return null;
  let c = propArt.get(kind);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = PROP_SIZE * PX;
    art.draw(partContext(c));
    propArt.set(kind, c);
  }
  return c;
}

/** `ctx` works in 1080x1920 frame pixels, as in drawFigure. */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  prop: { kind: string; x: number; y: number; scale: number; flip: boolean },
) {
  const art = propCanvas(prop.kind);
  if (!art) return;
  ctx.save();
  ctx.translate(prop.x * W, prop.y * H);
  ctx.scale(prop.scale * (prop.flip ? -1 : 1), prop.scale);
  ctx.drawImage(art, -PROP_SIZE / 2, -PROP_SIZE, PROP_SIZE, PROP_SIZE);
  ctx.restore();
}
