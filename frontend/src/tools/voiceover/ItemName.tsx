import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import type { Item } from "./types";

const MAX_NAME = 80;

/** A voiceover's name, shown as text until the pencil turns it into a box. */
export default function ItemName({
  item,
  onRename,
}: {
  item: Item;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  function finish(e: { currentTarget: HTMLInputElement }) {
    const name = e.currentTarget.value.trim();
    setDraft(null);
    if (!cancelled.current && name !== item.name) onRename(name);
    cancelled.current = false;
  }

  if (draft !== null)
    return (
      <input
        autoFocus
        value={draft}
        maxLength={MAX_NAME}
        placeholder="Name this voiceover"
        aria-label="Voiceover name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="input w-full py-1 text-sm"
      />
    );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <p className="truncate text-sm font-semibold">{item.name || item.text}</p>
      <button
        onClick={() => setDraft(item.name)}
        className="shrink-0 rounded p-1 text-muted hover:text-white"
        title="Rename"
        aria-label={`Rename ${item.name || item.text}`}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}
