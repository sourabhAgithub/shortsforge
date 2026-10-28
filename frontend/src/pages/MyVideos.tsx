import { Download, Film, Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, formatSeconds, type Video } from "../api";

export default function MyVideos() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<Video | null>(null);

  useEffect(() => {
    api<Video[]>("/api/videos").then(setVideos).catch((e) => setError(e.message));
  }, []);

  async function remove(v: Video) {
    if (!confirm(`Delete "${v.title}"? This can't be undone.`)) return;
    try {
      await api(`/api/videos/${v.id}`, { method: "DELETE" });
      setVideos((list) => list?.filter((x) => x.id !== v.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="text-3xl font-black tracking-tight uppercase">My Videos</h1>
      <p className="mt-1 text-muted">Every video you've generated, saved on this computer.</p>
      {error && <p className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {videos && videos.length === 0 && (
        <div className="card mt-8 p-12 text-center">
          <Film className="mx-auto size-10 text-muted" />
          <p className="mt-3 font-semibold">No videos yet</p>
          <p className="mt-1 text-sm text-muted">Generate your first Short with the Ranking Video tool.</p>
          <Link to="/ranking" className="btn-primary mt-6">
            Start Ranking
          </Link>
        </div>
      )}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
        {videos?.map((v) => (
          <div key={v.id} className="card overflow-hidden">
            <button className="group relative block aspect-[9/16] w-full bg-black" onClick={() => setPlaying(v)}>
              <img src={v.thumb} alt="" className="size-full object-cover" />
              <span className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/40">
                <Play className="size-12 fill-white text-white opacity-0 transition group-hover:opacity-100" />
              </span>
              <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold">
                {formatSeconds(v.duration)}
              </span>
            </button>
            <div className="p-3">
              <p className="truncate text-sm font-semibold" title={v.title}>
                {v.title}
              </p>
              <p className="mt-0.5 text-xs text-muted">{formatDate(v.created_at)}</p>
              <div className="mt-3 flex gap-2">
                <a href={v.download} className="btn-ghost flex-1 px-3 py-1.5 text-xs">
                  <Download className="size-3.5" /> Download
                </a>
                <button onClick={() => remove(v)} className="btn-ghost px-3 py-1.5 text-xs hover:text-red-300" title="Delete">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {playing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={() => setPlaying(null)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <video src={playing.video} controls autoPlay playsInline className="max-h-[85vh] max-w-full rounded-2xl bg-black" />
            <button onClick={() => setPlaying(null)} className="absolute top-2 right-2 rounded-full sm:-top-3 sm:-right-3 bg-panel-2 p-2 ring-1 ring-line">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
