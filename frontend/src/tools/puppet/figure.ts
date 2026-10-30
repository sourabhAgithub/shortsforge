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

export type Point = [number, number];
export type PartId = "head" | "torso" | "armL" | "armR" | "legL" | "legR";
export type Layers = Record<PartId, HTMLCanvasElement>;

export const PARTS: {
  id: PartId;
  label: string;
  joint: Point;
  zone: [number, number, number, number]; // x, y, w, h of where to draw it
}[] = [
  { id: "head", label: "Head", joint: [200, 215], zone: [100, 30, 200, 195] },
  { id: "torso", label: "Body", joint: HIP, zone: [120, 200, 160, 300] },
  {
    id: "armL",
    label: "Left arm",
    joint: [150, 245],
    zone: [50, 225, 115, 280],
  },
  {
    id: "armR",
    label: "Right arm",
    joint: [250, 245],
    zone: [235, 225, 115, 280],
  },
  {
    id: "legL",
    label: "Left leg",
    joint: [170, 470],
    zone: [120, 460, 80, 325],
  },
  {
    id: "legR",
    label: "Right leg",
    joint: [230, 470],
    zone: [200, 460, 80, 325],
  },
];

const LAYER_ORDER: PartId[] = ["legL", "legR", "torso", "armL", "armR", "head"];

export function makeLayers(): Layers {
  const one = () => {
    const c = document.createElement("canvas");
    c.width = FW * PX;
    c.height = FH * PX;
    return c;
  };
  return {
    head: one(),
    torso: one(),
    armL: one(),
    armR: one(),
    legL: one(),
    legR: one(),
  };
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

/** One timeline row: [x, flip, ...JOINTS]. `ctx` works in 1080x1920 frame pixels. */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  row: number[],
  scale: number,
) {
  const pose = Object.fromEntries(JOINTS.map((j, i) => [j, row[i + 2]]));
  const rot = (deg: number, [x, y]: Point) => {
    ctx.translate(x, y);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.translate(-x, -y);
  };
  const place = (id: PartId) => ctx.drawImage(layers[id], 0, 0, FW, FH);
  const joint = (id: PartId) => PARTS.find((p) => p.id === id)!.joint;

  ctx.save();
  ctx.translate(row[0] * W, GROUND * H);
  ctx.scale(scale * row[1], scale);
  ctx.translate(-FEET[0], -FEET[1] + pose.y);
  rot(pose.root, FEET);
  for (const id of LAYER_ORDER) {
    ctx.save();
    if (id === "legL" || id === "legR") {
      rot(pose[id], joint(id));
    } else {
      rot(pose.body, HIP);
      if (id !== "torso") rot(pose[id], joint(id));
    }
    place(id);
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
  if (c.style === "long") {
    ctx.fillStyle = c.hair;
    ctx.beginPath();
    ctx.roundRect(x - r - 10, y - r - 8, 2 * r + 20, 2 * r + 75, 70);
    ctx.fill();
  }
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

/** Replace every part with a ready-made character, to draw on top of. */
export function paintCharacter(layers: Layers, c: Character) {
  for (const p of PARTS) {
    const ctx = partContext(layers[p.id]);
    ctx.clearRect(0, 0, FW, FH);
    if (p.id === "head") paintHead(ctx, c);
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
