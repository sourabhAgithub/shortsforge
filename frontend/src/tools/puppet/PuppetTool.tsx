import { PersonStanding } from "lucide-react";
import { Route, Routes } from "react-router-dom";
import ToolHome from "../../components/ToolHome";
import PuppetEditor from "./PuppetEditor";

function PuppetHome() {
  return (
    <ToolHome
      tool={{ id: "puppet", icon: PersonStanding }}
      heading="Story Puppets"
      blurb="Pick a ready-made character or draw your own, give it actions like walk, wave or fall, and turn it into a story video."
      createLabel="Create Story"
      untitled="Untitled story"
      progress={(p) =>
        p.filled ? `${p.slots} actions` : "No character drawn yet"
      }
    />
  );
}

export default function PuppetTool() {
  return (
    <Routes>
      <Route index element={<PuppetHome />} />
      <Route path=":id" element={<PuppetEditor />} />
    </Routes>
  );
}
