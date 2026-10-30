import {
  AudioLines,
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatDate, formatSeconds } from "../../api";

type Voice = {
  id: string;
  name: string;
  gender: string;
  locale: string;
  language: string;
  styles: string[];
  sample?: string | null; // ready-made sample (ElevenLabs), played without using credits
};

type Item = {
  id: string;
  text: string;
  voice: string;
  rate: number;
  pitch: number;
  duration: number;
  created_at: number;
  url: string;
  download: string;
};

const MAX_CHARS = 20000;
const ELEVEN = "elevenlabs";
// Delivery tags. ElevenLabs acts them out; the free voices turn them into pauses and speed/pitch/volume.
const TAGS = [
  "whispers",
  "softly",
  "slowly",
  "nervous",
  "urgent",
  "excited",
  "sad",
  "pause",
  "long pause",
];
const SAVED_KEY = "voiceover.choice"; // last language + voice, so the picker opens where you left it

function loadChoice(): { locale?: string; voice?: string } {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveChoice(locale: string, voice: string) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ locale, voice }));
  } catch {
    /* storage blocked: nothing to remember */
  }
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit: string;
}) {
  return (
    <div>
      <div className="flex items-center">
        <span className="label mb-0">{label}</span>
        <span className="ml-auto font-mono text-xs text-muted tabular-nums">
          {value > 0 ? "+" : ""}
          {value}
          {unit}
        </span>
        {value !== 0 && (
          <button
            onClick={() => onChange(0)}
            className="ml-2 rounded p-0.5 text-muted hover:text-white"
            title="Reset"
          >
            <RotateCcw className="size-3" />
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand"
        aria-label={label}
      />
    </div>
  );
}

/** Type a script, pick a language and voice, get an MP3 to play and download. */
export default function VoiceoverTool() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [locale, setLocale] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [gender, setGender] = useState<"" | "Female" | "Male">("");
  const [rate, setRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState("");
  const [playing, setPlaying] = useState(""); // id of the voice sample or saved item playing
  const [latest, setLatest] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const [eleven, setEleven] = useState(true); // ElevenLabs key set (hides the "add a key" tip)
  const player = useRef<HTMLAudioElement>(null);
  const script = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<{ voices: Voice[]; elevenlabs: boolean }>("/api/voiceover/voices")
      .then(({ voices: v, elevenlabs }) => {
        setVoices(v);
        setEleven(elevenlabs);
        const saved = loadChoice();
        const start =
          v.find((x) => x.id === (saved.voice ?? "en-US-AriaNeural")) ??
          v.find((x) => x.locale === (saved.locale ?? "en-US")) ??
          v[0];
        if (start) {
          setLocale(start.locale);
          setVoiceId(start.id);
        }
      })
      .catch((e) => setError(e.message));
    api<Item[]>("/api/voiceover/items")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  const languages = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of voices ?? []) seen.set(v.locale, v.language);
    return [...seen].sort(
      (a, b) =>
        Number(b[0] === ELEVEN) - Number(a[0] === ELEVEN) ||
        a[1].localeCompare(b[1]),
    );
  }, [voices]);
  const inLanguage = (voices ?? []).filter((v) => v.locale === locale);
  const shown = inLanguage.filter((v) => !gender || v.gender === gender);
  const expressive = locale === ELEVEN;
  const voiceName = (id: string) =>
    voices?.find((v) => v.id === id)?.name ?? id.split("-").slice(2).join("-");

  function chooseLanguage(l: string) {
    setLocale(l);
    const first = (voices ?? []).find((v) => v.locale === l);
    if (first) {
      setVoiceId(first.id);
      saveChoice(l, first.id);
    }
  }

  function chooseVoice(v: Voice) {
    setVoiceId(v.id);
    saveChoice(v.locale, v.id);
  }

  function play(id: string, src: string) {
    const a = player.current!;
    if (playing === id) {
      a.pause();
      setPlaying("");
      return;
    }
    a.src = src;
    a.play().catch(() => setPlaying(""));
    setPlaying(id);
  }

  /** Put "[tag] " at the cursor in the script. */
  function insertTag(tag: string) {
    const el = script.current!;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const before = text.slice(0, a);
    const insert = `${before && !/\s$/.test(before) ? " " : ""}[${tag}] `;
    setText(before + insert + text.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + insert.length, a + insert.length);
    });
  }

  async function sample(v: Voice) {
    if (playing === v.id || v.sample) return play(v.id, v.sample ?? "");
    setSampling(v.id);
    setError("");
    try {
      const res = await fetch("/api/voiceover/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: v.id, rate, pitch }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).detail ??
            `Request failed (${res.status})`,
        );
      play(v.id, URL.createObjectURL(await res.blob()));
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Can't reach ShortsForge. Is the start window still open?"
          : (e as Error).message,
      );
    } finally {
      setSampling("");
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const item = await api<Item>("/api/voiceover/speak", {
        method: "POST",
        json: { text, voice: voiceId, rate, pitch },
      });
      setLatest(item);
      setItems((list) => [item, ...list]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Item) {
    if (!confirm("Delete this voiceover?")) return;
    try {
      await api(`/api/voiceover/items/${item.id}`, { method: "DELETE" });
      setItems((list) => list.filter((x) => x.id !== item.id));
      if (latest?.id === item.id) setLatest(null);
      if (playing === item.id) play(item.id, "");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <audio ref={player} onEnded={() => setPlaying("")} className="hidden" />
      <div className="card relative overflow-hidden p-5 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="grid size-16 place-items-center rounded-full bg-brand/20 text-sky ring-1 ring-brand/40">
            <AudioLines className="size-7" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black tracking-tight uppercase sm:text-3xl">
              Voice Generator
            </h1>
            <p className="mt-1 max-w-lg text-muted">
              Type a script, pick a language and voice, and download it as an
              MP3. Hundreds of natural voices in over 70 languages.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="card flex flex-col p-4 sm:p-6">
          <label className="label" htmlFor="script">
            Script
          </label>
          <textarea
            ref={script}
            id="script"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_CHARS}
            rows={12}
            placeholder="Type or paste what the voice should say. Write it in the voice's language."
            className="input min-h-60 flex-1 resize-y leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">Add a tag:</span>
            {TAGS.map((t) => (
              <button
                key={t}
                onClick={() => insertTag(t)}
                className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-xs text-sky ring-1 ring-line hover:bg-white/10"
              >
                [{t}]
              </button>
            ))}
            <span className="ml-auto text-xs text-muted tabular-nums">
              {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            Tags in square brackets are never read out.{" "}
            {expressive
              ? "ElevenLabs acts them out, and you can try others like [sighs], [laughs] or [crying]."
              : "Free voices turn them into pauses and changes of speed, pitch and loudness. For real whispers and emotion, pick an ElevenLabs voice."}
          </p>

          {latest && (
            <div className="mt-4 rounded-xl bg-ink p-4 ring-1 ring-brand/40">
              <p className="text-sm font-semibold">
                Your MP3 is ready · {voiceName(latest.voice)} ·{" "}
                {formatSeconds(latest.duration)}
              </p>
              <audio
                key={latest.id}
                src={latest.url}
                controls
                className="mt-3 w-full"
              />
              <a
                href={latest.download}
                download
                className="btn-primary mt-3 w-full"
              >
                <Download className="size-4" /> Download MP3
              </a>
            </div>
          )}
        </section>

        <section className="card flex flex-col gap-5 p-4 sm:p-6">
          <div>
            <label className="label" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              value={locale}
              onChange={(e) => chooseLanguage(e.target.value)}
              disabled={!voices}
              className="input"
            >
              {!voices && <option>Loading voices…</option>}
              {languages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            {voices && !eleven && (
              <p className="mt-2 text-xs text-muted">
                Want real whispers and emotion? Add an ElevenLabs API key (see
                the README) and its voices appear at the top of this list.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center">
              <span className="label mb-0">Voice</span>
              <div className="ml-auto flex gap-1 text-xs">
                {(["", "Female", "Male"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={`rounded-full px-2.5 py-1 ${gender === g ? "bg-brand/20 text-sky ring-1 ring-brand/40" : "text-muted hover:text-white"}`}
                  >
                    {g || "All"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
              {shown.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 ring-1 transition ${v.id === voiceId ? "bg-brand/15 ring-brand/50" : "ring-line hover:bg-white/5"}`}
                >
                  <button
                    onClick={() => chooseVoice(v)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-semibold">
                      {v.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[v.gender, ...v.styles].join(" · ")}
                    </span>
                  </button>
                  <button
                    onClick={() => sample(v)}
                    disabled={!!sampling}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-white/5 text-sky hover:bg-white/10 disabled:opacity-40"
                    title="Hear a sample (reads the start of your script)"
                  >
                    {sampling === v.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : playing === v.id ? (
                      <Pause className="size-3.5 fill-current" />
                    ) : (
                      <Play className="ml-0.5 size-3.5 fill-current" />
                    )}
                  </button>
                </div>
              ))}
              {voices && !shown.length && (
                <p className="text-sm text-muted">
                  No {gender.toLowerCase()} voices for this language.
                </p>
              )}
            </div>
          </div>

          {expressive ? (
            <p className="text-xs text-muted">
              ElevenLabs sets the pace and tone from the voice and your tags, so
              speed and pitch don&apos;t apply.
            </p>
          ) : (
            <>
              <Slider
                label="Speed"
                value={rate}
                onChange={setRate}
                min={-50}
                max={100}
                unit="%"
              />
              <Slider
                label="Pitch"
                value={pitch}
                onChange={setPitch}
                min={-50}
                max={50}
                unit=" Hz"
              />
            </>
          )}

          <button
            onClick={generate}
            disabled={busy || !text.trim() || !voiceId}
            className="btn-primary py-3 text-base"
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <AudioLines className="size-5" />
            )}
            {busy ? "Generating…" : "Generate MP3"}
          </button>
        </section>
      </div>

      <h2 className="mt-10 mb-4 text-sm font-semibold tracking-wider text-muted uppercase">
        Your voiceovers
      </h2>
      {!items.length && (
        <p className="text-sm text-muted">
          Nothing yet. Generate your first voiceover above.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="card flex items-center gap-3 p-3 sm:p-4"
          >
            <button
              onClick={() => play(item.id, item.url)}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white hover:brightness-110"
              title={playing === item.id ? "Pause" : "Play"}
            >
              {playing === item.id ? (
                <Pause className="size-4 fill-white" />
              ) : (
                <Play className="ml-0.5 size-4 fill-white" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.text}</p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {voiceName(item.voice)} · {formatSeconds(item.duration)} ·{" "}
                {formatDate(item.created_at)}
              </p>
            </div>
            <a
              href={item.download}
              download
              className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white"
              title="Download MP3"
            >
              <Download className="size-4" />
            </a>
            <button
              onClick={() => remove(item)}
              className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-red-300"
              title="Delete"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
