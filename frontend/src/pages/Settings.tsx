import { Check, Cookie } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";

type SettingsData = { cookies_browser: string; browsers: string[] };

const LABELS: Record<string, string> = {
  none: "Off (don't use cookies)",
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  brave: "Brave",
};

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<SettingsData>("/api/settings").then(setData).catch((e) => setError(e.message));
  }, []);

  async function choose(browser: string) {
    try {
      setData(await api<SettingsData>("/api/settings", { method: "PUT", json: { cookies_browser: browser } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="text-3xl font-black tracking-tight uppercase">Settings</h1>
      {error && <p className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      <div className="card mt-8 p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-brand/15 text-sky ring-1 ring-brand/40">
            <Cookie className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold">Use cookies from my browser</h2>
            <p className="mt-1 text-sm text-muted">
              Some Instagram (and sometimes YouTube) links only download when you're logged in. Pick the browser where
              you're logged in and ShortsForge will borrow its login cookies for downloads. They're never sent anywhere
              except the site the video comes from.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {data?.browsers.map((b) => (
                <button
                  key={b}
                  onClick={() => choose(b)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ring-1 transition ${
                    data.cookies_browser === b ? "bg-brand text-white ring-brand" : "bg-white/5 text-muted ring-line hover:text-white"
                  }`}
                >
                  {LABELS[b] ?? b}
                </button>
              ))}
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
                  <Check className="size-4" /> Saved
                </span>
              )}
            </div>
            <ul className="mt-5 list-disc space-y-1 pl-5 text-xs text-muted">
              <li>If it still fails, close that browser completely and try again.</li>
              <li>Safari on Mac: give Terminal "Full Disk Access" in System Settings → Privacy &amp; Security.</li>
              <li>Chrome on Windows may need to be closed while downloading.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
