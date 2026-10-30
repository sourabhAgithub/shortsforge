import { ACCESSORIES } from "./figure";

type Props = {
  chosen: Record<string, string>; // slot -> item
  onChange: (chosen: Record<string, string>) => void;
};

/** Hats, glasses and so on: one per slot, click again to take it off. */
export default function AccessoryPicker({ chosen, onChange }: Props) {
  function toggle(slot: string, item: string) {
    const next = { ...chosen };
    if (next[slot] === item) delete next[slot];
    else next[slot] = item;
    onChange(next);
  }

  return (
    <div className="mt-6">
      <p className="label">Attachments</p>
      <div className="flex flex-col gap-2.5">
        {ACCESSORIES.map(({ slot, label, items }) => (
          <div key={slot} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-xs text-muted">{label}</span>
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => toggle(slot, item.id)}
                aria-pressed={chosen[slot] === item.id}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${chosen[slot] === item.id ? "bg-brand/20 text-sky ring-1 ring-brand/50" : "bg-white/5 text-muted ring-1 ring-line hover:text-white"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
