import { Route, Routes } from "react-router-dom";
import { WorkspaceListPage } from "./pages/workspace-list";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceListPage />} />
    </Routes>
  );
}
