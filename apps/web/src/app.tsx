import { Route, Routes } from "react-router-dom";
import { CodocDetailPage } from "./pages/codoc-detail";
import { WorkspaceDetailPage } from "./pages/workspace-detail";
import { WorkspaceListPage } from "./pages/workspace-list";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceListPage />} />
      <Route path="/workspace/:id" element={<WorkspaceDetailPage />} />
      <Route
        path="/workspace/:workspaceId/codoc/:codocId"
        element={<CodocDetailPage />}
      />
    </Routes>
  );
}
