import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WorkspaceListPage } from "./pages/workspace-list.js";
import { WorkspaceDetailPage } from "./pages/workspace-detail.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WorkspaceListPage />} />
        <Route path="/workspace/:id" element={<WorkspaceDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
