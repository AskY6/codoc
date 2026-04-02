import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { getWorkspace } from "../api/workspace.js";
import { listCodocs, getCodoc } from "../api/codoc.js";
import { triggerBuild } from "../api/build.js";
import { getGraph } from "../api/graph.js";
import { Sidebar } from "../components/sidebar.js";
import { DetailPanel } from "../components/detail-panel.js";
import { ChatPanel } from "../components/chat-panel.js";
import type {
  Workspace,
  CodocListItem,
  CodocDetail,
  GraphData,
  BuildResult,
} from "../types.js";

export function WorkspaceDetailPage() {
  const { id: workspaceId } = useParams<{ id: string }>();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [codocs, setCodocs] = useState<CodocListItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [codocDetail, setCodocDetail] = useState<CodocDetail | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [building, setBuilding] = useState(false);

  // Load workspace + codocs
  useEffect(() => {
    if (!workspaceId) return;
    getWorkspace(workspaceId).then(setWorkspace);
    listCodocs(workspaceId).then(setCodocs);
    getGraph(workspaceId).then(setGraph);
  }, [workspaceId]);

  // Load codoc detail when selection changes
  useEffect(() => {
    if (!workspaceId || !selectedPath) {
      setCodocDetail(null);
      return;
    }
    getCodoc(workspaceId, selectedPath).then(setCodocDetail);
  }, [workspaceId, selectedPath]);

  const handleBuild = useCallback(async () => {
    if (!workspaceId) return;
    setBuilding(true);
    try {
      const result = await triggerBuild(workspaceId);
      setBuildResult(result);
      // Refresh codocs and graph after build
      listCodocs(workspaceId).then(setCodocs);
      getGraph(workspaceId).then(setGraph);
      if (selectedPath) getCodoc(workspaceId, selectedPath).then(setCodocDetail);
    } finally {
      setBuilding(false);
    }
  }, [workspaceId, selectedPath]);

  if (!workspaceId) return null;

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-gray-600 text-sm">
            &larr; Workspaces
          </a>
          <h1 className="font-semibold text-lg">
            {workspace?.name ?? "Loading..."}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {buildResult && (
            <span className={`text-xs ${buildResult.ok ? "text-green-600" : "text-red-600"}`}>
              {buildResult.ok
                ? `Build OK (${buildResult.codocCount} codocs, ${buildResult.edgeCount} edges)`
                : `Build failed (${buildResult.errors.length} errors)`}
            </span>
          )}
          <button
            onClick={handleBuild}
            disabled={building}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {building ? "Building..." : "Build"}
          </button>
        </div>
      </header>

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden three-col-layout">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-gray-200 bg-white overflow-y-auto sidebar-col">
          <Sidebar
            codocs={codocs}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            graph={graph}
          />
        </aside>

        {/* Detail panel */}
        <main className="flex-1 overflow-y-auto bg-gray-50 detail-col">
          <DetailPanel
            codocDetail={codocDetail}
            graph={graph}
            selectedPath={selectedPath}
          />
        </main>

        {/* Chat panel */}
        <aside className="w-96 shrink-0 border-l border-gray-200 bg-white overflow-hidden chat-col">
          <ChatPanel workspaceId={workspaceId} selectedPath={selectedPath} />
        </aside>
      </div>
    </div>
  );
}
