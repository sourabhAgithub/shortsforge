import { Download, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Video } from "../api";

type SavePicker = (options: {
  id?: string;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

const fileName = (title: string) =>
  `${title.replace(/[^\w\- ]/g, "").trim().replace(/ /g, "_").slice(0, 60) || "short"}.mp4`;

/**
 * Asks where to save the video, then writes it there. Only Chrome and Edge can ask, and only on
 * localhost or https; other browsers get an ordinary download to their Downloads folder.
 */
async function saveVideo(video: Video, setBusy: (busy: boolean) => void) {
  const pick = (window as unknown as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker;
  if (!pick) {
    const link = document.createElement("a");
    link.href = video.download;
    link.click();
    return;
  }
  const handle = await pick({
    id: "shortsforge-videos", // the browser reopens the folder used last time
    suggestedName: fileName(video.title),
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
  });
  setBusy(true);
  const response = await fetch(video.download);
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status})`);
  await response.body.pipeTo(await handle.createWritable());
}

/** Download button for a finished video. */
export default function SaveVideoButton({
  video,
  className,
  children,
}: {
  video: Video;
  className: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    setFailed(false);
    try {
      await saveVideo(video, setBusy);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setFailed(true); // AbortError = they pressed Cancel
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={save} disabled={busy} className={className}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : !failed && <Download className="size-4" />}
      {busy ? "Saving…" : failed ? "Couldn't save. Try again" : children}
    </button>
  );
}
