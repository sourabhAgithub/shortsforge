import { Loader2, Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, formatSeconds } from "../../api";
import type { Item } from "./types";

const MAX_SECONDS = 30 * 60;

type Props = {
  onRecorded: (item: Item) => void;
  onError: (message: string) => void;
};

/** Record from the microphone. The take is uploaded and kept as an MP3. */
export default function VoiceRecorder({ onRecorded, onError }: Props) {
  const [state, setState] = useState<
    "idle" | "asking" | "recording" | "saving"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);
  const stopMeter = useRef(() => {});
  const meter = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      cancelled.current = true;
      recorder.current?.stop();
    },
    [],
  );

  /** A live level bar, so you can see the microphone is hearing you. */
  function startMeter(stream: MediaStream) {
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      const peak = Math.max(...data.map((v) => Math.abs(v - 128))) / 128;
      if (meter.current) meter.current.style.width = `${peak * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    stopMeter.current = () => {
      cancelAnimationFrame(raf);
      audio.close();
    };
  }

  async function save(chunks: Blob[], type: string) {
    setState("saving");
    try {
      const form = new FormData();
      form.append("file", new Blob(chunks, { type }), "voice");
      onRecorded(
        await api<Item>("/api/voiceover/record", {
          method: "POST",
          body: form,
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  async function start() {
    onError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onError(
        "This browser can't record here. Open the app on localhost or an https:// address.",
      );
      return;
    }
    let stream: MediaStream;
    setState("asking");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      onError(
        (e as Error).name === "NotFoundError"
          ? "No microphone found. Plug one in and try again."
          : "Microphone access is blocked. Allow it in your browser's address bar, then try again.",
      );
      setState("idle");
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) rec.stop();
    }, 200);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer);
      stopMeter.current();
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      if (cancelled.current) setState("idle");
      else save(chunks, rec.mimeType);
    };
    rec.start();
    recorder.current = rec;
    cancelled.current = false;
    startMeter(stream);
    setSeconds(0);
    setState("recording");
  }

  function stop(keep: boolean) {
    cancelled.current = !keep;
    recorder.current?.stop();
  }

  return (
    <section className="card mt-6 flex flex-wrap items-center gap-4 p-4 sm:p-6">
      <div className="min-w-48 flex-1">
        <h2 className="font-bold">Record your voice</h2>
        {state === "recording" ? (
          <div className="mt-2 flex items-center gap-3">
            <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono text-sm tabular-nums">
              {formatSeconds(seconds)}
            </span>
            <div className="h-1.5 max-w-60 flex-1 overflow-hidden rounded-full bg-white/10">
              <div ref={meter} className="h-full rounded-full bg-sky" />
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm text-muted">
            Speak into your microphone, then trim it and set its speed.
          </p>
        )}
      </div>
      {state === "idle" && (
        <button onClick={start} className="btn-primary px-5 py-2.5">
          <Mic className="size-4" /> Record
        </button>
      )}
      {state === "asking" && (
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Allow the microphone in
          your browser…
        </span>
      )}
      {state === "recording" && (
        <>
          <button onClick={() => stop(false)} className="btn-ghost">
            <X className="size-4" /> Cancel
          </button>
          <button
            onClick={() => stop(true)}
            className="btn-primary px-5 py-2.5"
          >
            <Square className="size-4 fill-white" /> Stop
          </button>
        </>
      )}
      {state === "saving" && (
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Saving your recording…
        </span>
      )}
    </section>
  );
}
