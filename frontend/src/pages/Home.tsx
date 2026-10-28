import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { GROUPS, TOOLS, type ToolDef } from "../tools/registry";

function ToolCard({ tool }: { tool: ToolDef }) {
  const Icon = tool.icon;
  const ready = tool.status === "ready";
  return (
    <div
      className={`card relative flex flex-col p-5 ${
        ready ? "border-brand/40 bg-gradient-to-br from-brand/15 via-panel to-panel" : "opacity-70"
      }`}
    >
      <div className="mb-4 flex items-start justify-between">
        <div
          className={`grid size-11 place-items-center rounded-full ring-1 ${
            ready ? "bg-brand/20 text-sky ring-brand/40" : "bg-white/5 text-muted ring-line"
          }`}
        >
          <Icon className="size-5" />
        </div>
        {!ready && (
          <span className="rounded-full bg-amber/10 px-2.5 py-1 text-[11px] font-semibold text-amber">
            Coming soon
          </span>
        )}
      </div>
      <h3 className="font-bold text-white">{tool.name}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{tool.description}</p>
      {ready && (
        <Link to={`/${tool.id}`} className="btn-primary mt-5 self-start">
          {tool.cta ?? "Open"} <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="mb-10">
        <p className="text-sm font-semibold tracking-wider text-sky uppercase">Dashboard</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl tracking-tight uppercase">
          Make faceless Shorts <span className="bg-gradient-to-r from-brand to-sky bg-clip-text text-transparent">in minutes</span>
        </h1>
        <p className="mt-3 max-w-xl text-muted">
          Pick a format, drop in your clips and export a vertical video ready for YouTube Shorts, Reels or TikTok.
          Everything runs on your computer.
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g} className="mb-10">
          <h2 className="mb-4 text-sm font-semibold tracking-wider text-muted uppercase">{g}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
