import { Route, Routes } from "react-router-dom";
import { WorkspaceDetailPage } from "./pages/workspace-detail";
import { WorkspaceListPage } from "./pages/workspace-list";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceListPage />} />
      <Route path="/workspace/:id" element={<WorkspaceDetailPage />} />
    </Routes>
  );
}
