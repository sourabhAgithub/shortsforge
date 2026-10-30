import { Video } from "lucide-react";
import { Route, Routes } from "react-router-dom";
import ToolHome from "../../components/ToolHome";
import VideoGenEditor from "./VideoGenEditor";

function VideoGenHome() {
  return (
    <ToolHome
      tool={{ id: "videogen", icon: Video }}
      heading="Video Generator"
      blurb="Edit one video into a Short: trim it, mute or keep its sound, add your own audio, auto-timed captions and text anywhere on screen."
      createLabel="Create Video"
      untitled="Untitled video"
      progress={(p) =>
        p.filled ? `${p.slots} captions & texts` : "No video added yet"
      }
    />
  );
}

export default function VideoGenTool() {
  return (
    <Routes>
      <Route index element={<VideoGenHome />} />
      <Route path=":id" element={<VideoGenEditor />} />
    </Routes>
  );
}
