import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, RotateCcw, Shuffle } from "lucide-react";
import { countdown, MEDALS, playbackOrder, shuffledOrder } from "./layout";
import type { Project } from "./types";

function Row({ rank, project, position }: { rank: number; project: Project; position: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rank });
  const slot = project.slots[rank - 1];
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-xl border border-line bg-ink px-3 py-2 ${isDragging ? "z-10 shadow-xl shadow-black/50 ring-1 ring-brand" : ""}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab touch-none text-muted hover:text-white active:cursor-grabbing" title="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 text-xs text-muted">{position}.</span>
      <div className="h-10 w-6 shrink-0 overflow-hidden rounded bg-white/5">
        {slot?.clip && <img src={slot.clip.thumb} className="size-full object-cover" alt="" />}
      </div>
      <span className="text-sm font-black" style={{ color: MEDALS[rank] ?? "#fff" }}>
        #{rank}
      </span>
      <span className="truncate text-sm text-muted">{slot?.caption || "No caption"}</span>
    </div>
  );
}

export default function PlaybackOrder({ project, onChange }: { project: Project; onChange: (p: Partial<Project>) => void }) {
  const order = playbackOrder(project);
  const n = project.slots.length;
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    onChange({ order: arrayMove(order, order.indexOf(Number(e.active.id)), order.indexOf(Number(e.over.id))) });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-ink px-3 py-2.5 ring-1 ring-line">
        {order.map((r, i) => (
          <span key={r} className="inline-flex items-center gap-1">
            <span className="rounded-md bg-white/5 px-2 py-0.5 text-sm font-black" style={{ color: MEDALS[r] ?? "#fff" }}>
              #{r}
            </span>
            {i < order.length - 1 && <ChevronRight className="size-3.5 text-muted" />}
          </span>
        ))}
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Custom playback order</p>
          <p className="text-xs text-muted">
            {project.custom_order ? "Drag ranks to reorder, or shuffle." : `Plays as a countdown: ${n} → 1.`}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={project.custom_order}
          onClick={() => onChange({ custom_order: !project.custom_order, order: project.custom_order ? project.order : order })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${project.custom_order ? "bg-brand" : "bg-white/10"}`}
        >
          <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${project.custom_order ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </label>

      {project.custom_order && (
        <div className="mt-4">
          <div className="mb-3 flex gap-2">
            <button onClick={() => onChange({ order: shuffledOrder(n) })} className="btn-ghost px-4 py-2">
              <Shuffle className="size-4" /> Shuffle
            </button>
            <button onClick={() => onChange({ order: countdown(n) })} className="btn-ghost px-4 py-2">
              <RotateCcw className="size-4" /> Countdown
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">Shuffle mixes the ranks up and keeps #1 for last, so viewers stay to the end.</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {order.map((r, i) => (
                  <Row key={r} rank={r} project={project} position={i + 1} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
