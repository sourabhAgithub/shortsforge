import { Hourglass } from "lucide-react";
import type { ToolDef } from "../tools/registry";

export default function ComingSoon({ tool }: { tool: ToolDef }) {
  const Icon = tool.icon;
  return (
    <div className="grid min-h-full place-items-center px-4 py-16 sm:px-8">
      <div className="card max-w-md p-6 text-center sm:p-10">
        <div className="mx-auto mb-6 grid size-20 place-items-center rounded-full bg-gradient-to-br from-brand/25 to-sky/10 text-sky ring-1 ring-brand/40">
          <Icon className="size-9" />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/10 px-3 py-1 text-xs font-semibold text-amber">
          <Hourglass className="size-3.5" /> Coming soon
        </span>
        <h1 className="mt-4 text-2xl font-black tracking-tight uppercase">{tool.name}</h1>
        <p className="mt-2 text-muted">{tool.description}</p>
        <p className="mt-6 text-xs text-muted/70">This tool isn't available yet. Ranking Video is ready to use today.</p>
      </div>
    </div>
  );
}
