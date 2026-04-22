import { useState, useEffect, useCallback } from "react";
import { api } from "./api.ts";
import type { TreeNode, CodocDetail, DagStatus } from "./api.ts";
import { FileTree } from "./components/FileTree.tsx";
import { Preview } from "./components/Preview.tsx";
import { DataPanel } from "./components/DataPanel.tsx";
import { GraphPanel } from "./components/GraphPanel.tsx";
import { ComponentPanel } from "./components/ComponentPanel.tsx";
import { useCustomComponents } from "./custom-components.ts";

// ---------------------------------------------------------------------------
// Focus — the single piece of state that decides what the main panel shows
// ---------------------------------------------------------------------------

type Focus =
  | { kind: "codoc"; path: string }
  | { kind: "graph" }
  | { kind: "component"; name: string }
  | { kind: "none" };

type DocTab = "preview" | "data";

export function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [focus, setFocus] = useState<Focus>({ kind: "none" });
  const [codoc, setCodoc] = useState<CodocDetail | null>(null);
  const [docTab, setDocTab] = useState<DocTab>("preview");
  const [error, setError] = useState<string | null>(null);
  const [dagData, setDagData] = useState<DagStatus | null>(null);
  const components = useCustomComponents(0);

  // --- Data loading --------------------------------------------------------

  const loadTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tree");
    }
  }, []);

  const loadDag = useCallback(async () => {
    try {
      setDagData(await api.dag());
    } catch { /* not critical */ }
  }, []);

  useEffect(() => {
    void loadTree();
    void loadDag();
    const id = setInterval(() => { void loadTree(); void loadDag(); }, 3000);
    return () => clearInterval(id);
  }, [loadTree, loadDag]);

  // Load codoc detail when a codoc is focused
  const codocPath = focus.kind === "codoc" ? focus.path : null;

  const fetchCodoc = useCallback(async (path: string) => {
    try {
      const c = await api.codoc(path);
      setCodoc((prev) => {
        if (prev && prev.path === c.path && prev.content === c.content) return prev;
        return c;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load codoc");
    }
  }, []);

  useEffect(() => {
    if (!codocPath) {
      setCodoc(null);
      return;
    }
    void fetchCodoc(codocPath);
    const id = setInterval(() => void fetchCodoc(codocPath), 2000);
    return () => clearInterval(id);
  }, [codocPath, fetchCodoc]);

  // --- Navigation helpers --------------------------------------------------

  const selectCodoc = useCallback((path: string) => {
    setFocus({ kind: "codoc", path });
  }, []);

  // --- Sidebar active state ------------------------------------------------

  const sidebarItems: { id: string; label: string; active: boolean; onClick: () => void }[] = [
    {
      id: "graph",
      label: "Graph",
      active: focus.kind === "graph",
      onClick: () => setFocus({ kind: "graph" }),
    },
    {
      id: "components",
      label: "Components",
      active: focus.kind === "component",
      onClick: () => setFocus({ kind: "component", name: "" }),
    },
  ];

  // --- DocTabs -------------------------------------------------------------

  const docTabs: { id: DocTab; label: string }[] = [
    { id: "preview", label: "Preview" },
    { id: "data", label: "Data" },
  ];

  // --- Render --------------------------------------------------------------

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-neutral-200 bg-neutral-50">
        <div className="border-b border-neutral-200 px-3 py-2">
          <h1 className="text-sm font-semibold tracking-tight">codoc</h1>
        </div>

        {/* Codoc tree */}
        <nav className="flex-1 overflow-auto p-2">
          {tree.length > 0 ? (
            <FileTree
              tree={tree}
              selectedPath={codocPath}
              onSelect={selectCodoc}
            />
          ) : (
            <p className="px-2 text-xs text-neutral-400">No files</p>
          )}
        </nav>

        {/* Peer navigation: Graph / Components */}
        <div className="border-t border-neutral-200 p-2 space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`w-full rounded px-3 py-1.5 text-left text-sm ${
                item.active
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content panel — renders whatever has focus */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        )}

        {focus.kind === "graph" ? (
          <GraphPanel dag={dagData} onSelectCodoc={selectCodoc} />
        ) : focus.kind === "component" ? (
          <ComponentPanel
            builtinRegistry={components.builtinRegistry}
            customRegistry={components.customRegistry}
            errors={components.errors}
          />
        ) : codoc ? (
          <>
            {/* Header */}
            <header className="flex items-center gap-4 border-b border-neutral-200 px-4 py-2">
              <span className="text-sm font-medium">
                {codoc.meta.title ?? codoc.path}
              </span>
              {codoc.meta.tags.length > 0 && (
                <div className="flex gap-1">
                  {codoc.meta.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </header>

            {/* Tabs */}
            <div className="flex border-b border-neutral-200">
              {docTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`px-4 py-2 text-sm ${
                    docTab === tab.id
                      ? "border-b-2 border-blue-600 text-blue-700"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                  onClick={() => setDocTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {docTab === "preview" && (
                <Preview view={codoc.view} data={codoc.data} componentMap={components.componentMap} />
              )}
              {docTab === "data" && <DataPanel data={codoc.data} />}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-neutral-400">
            Select a codoc from the sidebar
          </div>
        )}
      </main>
    </div>
  );
}
