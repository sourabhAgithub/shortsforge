import {
  Circle,
  Eraser,
  Minus,
  PaintBucket,
  Pencil,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CHARACTERS,
  type Character,
  FH,
  FW,
  HAIR_PARTS,
  hairColour,
  type Layers,
  type PartId,
  PARTS,
  type Point,
  type View,
  paintCharacter,
  mainColour,
  partAt,
  partContext,
  recolour,
  type Rgb,
  sameColour,
  twin,
} from "./figure";

type Tool = "pen" | "fill" | "eraser" | "circle" | "box" | "line";
const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "fill", label: "Fill: change a colour", icon: PaintBucket },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "box", label: "Box", icon: Square },
  { id: "line", label: "Line", icon: Minus },
  { id: "eraser", label: "Eraser", icon: Eraser },
];
const COLORS = [
  "#111111", "#FFFFFF", "#E8B48C", "#C68E63", "#2B1B12", "#E8467C",
  "#C2274B", "#F2A33A", "#2F9E6E", "#3A6EA5", "#7A5BA6", "#9AA0A6",
]; // prettier-ignore
const MAX_UNDO = 8;

type Props = {
  layers: Layers;
  drawn: boolean; // something is on the figure already (asks before replacing it)
  accessories: Record<string, string>; // redraws the board when these change
  view: View;
  onView: (v: View) => void;
  onChange: (parts: PartId[]) => void;
  onCharacter: (c: Character) => void;
};

/** Draw the figure one body part at a time, over a guide that shows where each part goes. */
export default function DrawingBoard({
  layers,
  drawn,
  accessories,
  view,
  onView,
  onChange,
  onCharacter,
}: Props) {
  const [part, setPart] = useState<PartId>("head");
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(12);
  const [canUndo, setCanUndo] = useState(false);
  const board = useRef<HTMLCanvasElement>(null);
  const undo = useRef<{ id: PartId; data: ImageData }[][]>([]);
  const shape = useRef<{ from: Point; to: Point } | null>(null);

  const paintShape = useCallback(
    (ctx: CanvasRenderingContext2D, s: { from: Point; to: Point }) => {
      const [[x0, y0], [x1, y1]] = [s.from, s.to];
      ctx.fillStyle = ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (tool === "line") {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      } else if (tool === "box") {
        ctx.roundRect(
          Math.min(x0, x1),
          Math.min(y0, y1),
          Math.abs(x1 - x0),
          Math.abs(y1 - y0),
          10,
        );
        ctx.fill();
      } else {
        ctx.ellipse(
          (x0 + x1) / 2,
          (y0 + y1) / 2,
          Math.abs(x1 - x0) / 2,
          Math.abs(y1 - y0) / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    },
    [color, size, tool],
  );

  const redraw = useCallback(() => {
    const ctx = board.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, FW, FH);
    const active = PARTS.find((p) => p.id === part)!;
    for (const p of PARTS.filter((x) => x.view === view)) {
      ctx.globalAlpha = p.id === part ? 1 : 0.3;
      ctx.drawImage(layers[p.id], 0, 0, FW, FH);
      const extra = `${p.id}_extra` as PartId;
      if (extra in layers) ctx.drawImage(layers[extra], 0, 0, FW, FH);
    }
    ctx.globalAlpha = 1;
    if (shape.current) paintShape(ctx, shape.current);
    const [x, y, w, h] = active.zone;
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = "#4F7CFF";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#4F7CFF";
    ctx.beginPath();
    ctx.arc(...active.joint, 7, 0, Math.PI * 2);
    ctx.fill();
  }, [layers, paintShape, part, view]);

  useEffect(redraw, [redraw, drawn, accessories]);

  function remember(
    step = [
      {
        id: part,
        data: layers[part]
          .getContext("2d")!
          .getImageData(0, 0, layers[part].width, layers[part].height),
      },
    ],
  ) {
    undo.current.push(step);
    if (undo.current.length > MAX_UNDO) undo.current.shift();
    setCanUndo(true);
  }

  /** Paint one colour on some parts with the chosen one. */
  function paint(ids: PartId[], from: Rgb, hex: string) {
    const value = (at: number) => parseInt(hex.slice(at, at + 2), 16);
    const to: Rgb = [value(1), value(3), value(5)];
    const before = recolour(layers, ids, from, to);
    if (!before.length) return;
    remember(before);
    redraw();
    onChange(before.map((b) => b.id));
  }

  function fill(point: Point) {
    const hit = partAt(layers, view, point);
    if (!hit) return;
    const hair = hairColour(layers);
    if (hair && sameColour(hit.rgb, hair)) {
      setPart(view === "front" ? "hair" : "hair_side");
      paint(HAIR_PARTS, hair, color);
    } else {
      setPart(hit.id);
      paint([hit.id, twin(hit.id)], hit.rgb, color);
    }
  }

  function chooseColor(next: string) {
    setColor(next);
    if (tool !== "fill") return;
    if (HAIR_PARTS.slice(0, 2).includes(part)) {
      const hair = hairColour(layers);
      if (hair) paint(HAIR_PARTS, hair, next);
      return;
    }
    const main = mainColour(layers, part) ?? mainColour(layers, twin(part));
    if (main) paint([part, twin(part)], main, next);
  }

  function at(e: { clientX: number; clientY: number }): Point {
    const r = board.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * FW,
      ((e.clientY - r.top) / r.height) * FH,
    ];
  }

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (tool === "fill") return fill(at(e));
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    remember();
    const ctx = partContext(layers[part]);
    let last = at(e);
    const freehand = tool === "pen" || tool === "eraser";
    if (!freehand) shape.current = { from: last, to: last };

    const stroke = (to: Point) => {
      ctx.globalCompositeOperation =
        tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = tool === "eraser" ? size * 2 : size;
      ctx.beginPath();
      ctx.moveTo(...last);
      ctx.lineTo(...to);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      last = to;
    };
    if (freehand) stroke([last[0] + 0.01, last[1]]); // a tap leaves a dot
    redraw();

    const move = (ev: PointerEvent) => {
      if (freehand) stroke(at(ev));
      else shape.current!.to = at(ev);
      redraw();
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (shape.current) {
        paintShape(ctx, shape.current);
        shape.current = null;
      }
      redraw();
      onChange([part]);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function stepBack() {
    const step = undo.current.pop();
    if (!step) return;
    for (const { id, data } of step)
      layers[id].getContext("2d")!.putImageData(data, 0, 0);
    setCanUndo(!!undo.current.length);
    redraw();
    onChange(step.map((s) => s.id));
  }

  function clearPart() {
    remember();
    partContext(layers[part]).clearRect(0, 0, FW, FH);
    redraw();
    onChange([part]);
  }

  function useCharacter(c: Character) {
    if (drawn && !confirm(`Replace your figure with ${c.label}?`)) return;
    undo.current = [];
    setCanUndo(false);
    paintCharacter(layers, c);
    redraw();
    onChange(PARTS.map((p) => p.id));
    onCharacter(c);
  }

  function showView(next: View) {
    const same = PARTS.find((p) => p.id === part)!.base;
    onView(next);
    setPart(PARTS.find((p) => p.base === same && p.view === next)!.id);
  }

  return (
    <div>
      <p className="label">Start from a character</p>
      <div className="flex flex-wrap gap-2">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            onClick={() => useCharacter(c)}
            className="btn-ghost px-3.5 py-2"
          >
            <span
              className="size-3 rounded-full ring-1 ring-white/30"
              style={{ background: c.top }}
            />
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Then change anything: pick a body part below and draw on it, or start
        from blank and draw every part yourself.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-[240px_1fr]">
        <canvas
          ref={board}
          width={FW}
          height={FH}
          onPointerDown={down}
          className="mx-auto aspect-[1/2] w-full max-w-60 cursor-crosshair touch-none rounded-xl bg-white"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <p className="label">View</p>
            <div className="flex gap-1.5">
              {(["front", "side"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => showView(v)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-brand/20 text-sky ring-1 ring-brand/50" : "bg-white/5 text-muted ring-1 ring-line hover:text-white"}`}
                >
                  {v}
                </button>
              ))}
            </div>
            {view === "side" && (
              <p className="mt-2 text-xs text-muted">
                Used for walking. Draw it facing right; it mirrors by itself. A
                blank part borrows the front drawing.
              </p>
            )}
          </div>

          <div>
            <p className="label">Body part</p>
            <div className="flex flex-wrap gap-1.5">
              {PARTS.filter((p) => p.view === view).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPart(p.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${part === p.id ? "bg-brand/20 text-sky ring-1 ring-brand/50" : "bg-white/5 text-muted ring-1 ring-line hover:text-white"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Stay inside the blue box. The dot is the joint it turns around.
            </p>
          </div>

          <div>
            <p className="label">Tool</p>
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTool(id)}
                  title={label}
                  aria-label={label}
                  className={`grid size-9 place-items-center rounded-lg ${tool === id ? "bg-brand/20 text-sky ring-1 ring-brand/50" : "bg-white/5 text-muted ring-1 ring-line hover:text-white"}`}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">Colour</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => chooseColor(c)}
                  aria-label={c}
                  className={`size-7 rounded-full ring-1 ${color === c ? "ring-2 ring-sky" : "ring-white/20"}`}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => chooseColor(e.target.value.toUpperCase())}
                className="h-7 w-9 cursor-pointer rounded bg-transparent"
                aria-label="Any colour"
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              With the Fill tool on, click a colour to paint the selected body
              part, or click a part on the figure. It changes in both views.
            </p>
          </div>

          <div>
            <p className="label">Thickness</p>
            <input
              type="range"
              min={3}
              max={50}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full accent-brand"
              aria-label="Thickness"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={stepBack}
              disabled={!canUndo}
              className="btn-ghost"
            >
              <Undo2 className="size-4" /> Undo
            </button>
            <button onClick={clearPart} className="btn-ghost">
              <Trash2 className="size-4" /> Clear part
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
