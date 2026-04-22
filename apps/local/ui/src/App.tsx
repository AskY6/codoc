import { useState, useEffect, useCallback } from "react";
import { api } from "./api.ts";
import type { TreeNode, CodocDetail } from "./api.ts";
import { FileTree } from "./components/FileTree.tsx";
import { Editor } from "./components/Editor.tsx";
import { Preview } from "./components/Preview.tsx";
import { DataPanel } from "./components/DataPanel.tsx";

type Tab = "editor" | "preview" | "data";

export function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [codoc, setCodoc] = useState<CodocDetail | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("editor");
  const [error, setError] = useState<string | null>(null);

  // Load file tree
  const loadTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tree");
    }
  }, []);

  useEffect(() => { void loadTree(); }, [loadTree]);

  // Load codoc when selection changes
  useEffect(() => {
    if (!selectedPath) {
      setCodoc(null);
      return;
    }
    let cancelled = false;
    void api.codoc(selectedPath).then((c) => {
      if (!cancelled) {
        setCodoc(c);
        setError(null);
      }
    }).catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : "Failed to load codoc");
      }
    });
    return () => { cancelled = true; };
  }, [selectedPath]);

  const handleSave = useCallback(async (content: string) => {
    if (!selectedPath) return;
    const result = await api.writeCodoc(selectedPath, content);
    if (!result.ok) {
      setError(result.error ?? "Save failed");
      return;
    }
    // Reload
    setCodoc(await api.codoc(selectedPath));
    void loadTree();
  }, [selectedPath, loadTree]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "editor", label: "Editor" },
    { id: "preview", label: "Preview" },
    { id: "data", label: "Data" },
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-neutral-200 bg-neutral-50">
        <div className="border-b border-neutral-200 px-3 py-2">
          <h1 className="text-sm font-semibold tracking-tight">codoc</h1>
        </div>
        <nav className="flex-1 overflow-auto p-2">
          {tree.length > 0 ? (
            <FileTree
              tree={tree}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          ) : (
            <p className="px-2 text-xs text-neutral-400">No files</p>
          )}
        </nav>
      </aside>

      {/* Main */}
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

        {codoc ? (
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
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`px-4 py-2 text-sm ${
                    activeTab === tab.id
                      ? "border-b-2 border-blue-600 text-blue-700"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {activeTab === "editor" && (
                <Editor content={codoc.content} onSave={handleSave} />
              )}
              {activeTab === "preview" && <Preview view={codoc.view} />}
              {activeTab === "data" && <DataPanel data={codoc.data} />}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-neutral-400">
            {selectedPath ? "Loading..." : "Select a codoc from the sidebar"}
          </div>
        )}
      </main>
    </div>
  );
}
