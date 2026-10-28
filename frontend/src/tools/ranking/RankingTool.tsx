import { Route, Routes } from "react-router-dom";
import RankingEditor from "./RankingEditor";
import RankingHome from "./RankingHome";

export default function RankingTool() {
  return (
    <Routes>
      <Route index element={<RankingHome />} />
      <Route path=":id" element={<RankingEditor />} />
    </Routes>
  );
}
