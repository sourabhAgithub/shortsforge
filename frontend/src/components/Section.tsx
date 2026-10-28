import type { ReactNode } from "react";

/** Numbered editor card used by the tool editors. */
export default function Section({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-brand/15 text-xs font-bold text-sky ring-1 ring-brand/40">{n}</span>
        <h2 className="font-bold tracking-tight uppercase">{title}</h2>
        <div className="ml-auto">{aside}</div>
      </div>
      {children}
    </section>
  );
}
