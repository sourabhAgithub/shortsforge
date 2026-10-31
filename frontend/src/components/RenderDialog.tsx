import { AlertCircle, CheckCircle2, Film, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { Job, Video } from "../api";
import SaveVideoButton from "./SaveVideoButton";

export type RenderState = { job: Job<Video> | null; error?: string; video?: Video };

export default function RenderDialog({ state, onClose }: { state: RenderState; onClose: () => void }) {
  const { job, error, video } = state;
  const running = !video && !error;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="card relative w-full max-w-md p-5 sm:p-7">
        {!running && (
          <button onClick={onClose} className="absolute top-4 right-4 rounded-full p-1.5 text-muted hover:bg-white/5 hover:text-white">
            <X className="size-4" />
          </button>
        )}
        {running && (
          <>
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-sky" />
              <h2 className="text-lg font-bold">Generating your Short…</h2>
            </div>
            <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-deep via-brand to-sky transition-all duration-500"
                style={{ width: `${Math.max(3, (job?.progress ?? 0) * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-sm text-muted">
              <span>{job?.step ?? "Starting…"}</span>
              <span>{Math.round((job?.progress ?? 0) * 100)}%</span>
            </div>
            <p className="mt-6 text-xs text-muted/70">Keep this window open. It usually takes under a minute.</p>
          </>
        )}
        {error && (
          <>
            <div className="flex items-center gap-3 text-red-300">
              <AlertCircle className="size-5" />
              <h2 className="text-lg font-bold">Couldn't generate the video</h2>
            </div>
            <p className="mt-4 text-sm text-muted">{error}</p>
            <button onClick={onClose} className="btn-ghost mt-6">
              Back to editor
            </button>
          </>
        )}
        {video && (
          <>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="size-5" />
              <h2 className="text-lg font-bold text-white">Your Short is ready</h2>
            </div>
            <video src={video.video} controls autoPlay className="mx-auto mt-5 max-h-[60vh] rounded-xl bg-black" />
            <div className="mt-5 flex gap-2">
              <SaveVideoButton video={video} className="btn-primary flex-1">
                Download MP4
              </SaveVideoButton>
              <Link to="/videos" className="btn-ghost">
                <Film className="size-4" /> My Videos
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
