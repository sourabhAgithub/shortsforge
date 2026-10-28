import { Clapperboard } from "lucide-react";
import { Route, Routes } from "react-router-dom";
import ToolHome from "../../components/ToolHome";
import AiVideoEditor from "./AiVideoEditor";

function AiVideoHome() {
  return (
    <ToolHome
      tool={{ id: "aivideo", icon: Clapperboard }}
      heading="AI Video Generator"
      blurb="Upload a voiceover, paste a scene-by-scene script, and get footage generated from each scene's description, cut into a finished Short with captions and a ranking list."
      createLabel="Create AI Video"
      untitled="Untitled video"
      progress={(p) => `${p.filled}/${p.slots} scenes with footage`}
    />
  );
}

export default function AiVideoTool() {
  return (
    <Routes>
      <Route index element={<AiVideoHome />} />
      <Route path=":id" element={<AiVideoEditor />} />
    </Routes>
  );
}
