import { Trophy } from "lucide-react";
import ToolHome from "../../components/ToolHome";

export default function RankingHome() {
  return (
    <ToolHome
      tool={{ id: "ranking", icon: Trophy }}
      heading="Ranking Videos"
      blurb="Paste 5–7 clips, give each a caption, and get a countdown Short with a bold title and a rank list that fills in as it plays."
      createLabel="Create Ranking Video"
      untitled="Untitled ranking"
      progress={(p) => `${p.filled}/${p.slots} clips ready`}
    />
  );
}
