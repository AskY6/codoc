import { useState, useEffect, useCallback } from "react";
import { api } from "./api.ts";
import type { TreeNode, CodocDetail, DagStatus } from "./api.ts";
import { FileTree } from "./components/FileTree.tsx";
import { Preview } from "./components/Preview.tsx";
import { DataPanel } from "./components/DataPanel.tsx";
import { GraphPanel } from "./components/GraphPanel.tsx";
import { ComponentPanel } from "./components/ComponentPanel.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { useCustomComponents } from "./custom-components.ts";

// ---------------------------------------------------------------------------
// Focus — the single piece of state that decides what the main panel shows
// ---------------------------------------------------------------------------

type Focus =
  | { kind: "codoc"; path: string }
  | { kind: "graph" }
  | { kind: "component"; name: string }
  | { kind: "chat" }
  | { kind: "none" };

type DocTab = "preview" | "data";

export function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
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

  const handleNewCodoc = useCallback(async () => {
    const name = window.prompt("Enter new codoc name (e.g. notes/my-doc.codoc)");
    if (!name) return;
    const path = name.endsWith(".codoc") ? name : `${name}.codoc`;
    try {
      const content = `---\ntitle: "${name.split("/").pop()}"\ntags: []\n---\n\n# ${name}\n`;
      await api.writeCodoc(path, content);
      await loadTree();
      selectCodoc(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create codoc");
    }
  }, [loadTree, selectCodoc]);

  // --- Sidebar active state ------------------------------------------------

  const sidebarItems: { id: string; label: string; active: boolean; icon: React.ReactNode; onClick: () => void }[] = [
    {
      id: "graph",
      label: "Graph",
      active: focus.kind === "graph",
      icon: <GraphIcon />,
      onClick: () => setFocus({ kind: "graph" }),
    },
    {
      id: "components",
      label: "Components",
      active: focus.kind === "component",
      icon: <LayersIcon />,
      onClick: () => setFocus({ kind: "component", name: "" }),
    },
    {
      id: "chat",
      label: "Chat",
      active: focus.kind === "chat",
      icon: <ChatSidebarIcon />,
      onClick: () => setFocus({ kind: "chat" }),
    },
  ];

  // --- DocTabs -------------------------------------------------------------

  const docTabs: { id: DocTab; label: string }[] = [
    { id: "preview", label: "Preview" },
    { id: "data", label: "Data" },
  ];

  // --- Render --------------------------------------------------------------

  return (
    <div className="flex h-screen bg-neutral-100 text-neutral-900 antialiased">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50 shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-blue-600">codoc</h1>
          <button
            onClick={handleNewCodoc}
            className="rounded-md bg-blue-600 p-1.5 text-white transition-colors hover:bg-blue-700"
            title="New Codoc"
          >
            <PlusIcon />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Codoc tree */}
        <nav className="flex-1 overflow-auto px-2 py-1">
          {tree.length > 0 ? (
            <FileTree
              tree={tree}
              selectedPath={codocPath}
              onSelect={selectCodoc}
              searchTerm={searchTerm}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 opacity-40">
              <FileIcon className="mb-2 h-8 w-8" />
              <p className="text-xs">No files found</p>
            </div>
          )}
        </nav>

        {/* Peer navigation: Graph / Components */}
        <div className="border-t border-neutral-200 bg-neutral-50/80 p-3 space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all ${
                item.active
                  ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-200"
                  : "text-neutral-600 hover:bg-neutral-200/60"
              }`}
              onClick={item.onClick}
            >
              <span className={item.active ? "text-white" : "text-neutral-400"}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content panel — renders whatever has focus */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white">
        {error && (
          <div className="mx-4 mt-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 shadow-sm animate-in fade-in slide-in-from-top-2">
            <span className="flex items-center gap-2">
              <AlertIcon />
              {error}
            </span>
            <button
              type="button"
              className="rounded-full p-1 hover:bg-red-100"
              onClick={() => setError(null)}
            >
              <XIcon />
            </button>
          </div>
        )}

        {focus.kind === "chat" ? (
          <ChatPanel activeCodoc={codocPath} />
        ) : focus.kind === "graph" ? (
          <GraphPanel dag={dagData} onSelectCodoc={selectCodoc} />
        ) : focus.kind === "component" ? (
          <ComponentPanel
            builtinRegistry={components.builtinRegistry}
            customRegistry={components.customRegistry}
            errors={components.errors}
          />
        ) : codoc ? (
          <div className="flex h-full flex-col">
            {/* Header */}
            <header className="flex h-14 items-center justify-between border-b border-neutral-200 px-6">
              <div className="flex items-center gap-3">
                <FileIcon className="text-blue-500" />
                <h2 className="text-base font-semibold text-neutral-800">
                  {codoc.meta.title ?? codoc.path}
                </h2>
                {codoc.meta.tags.length > 0 && (
                  <div className="ml-2 flex gap-1.5">
                    {codoc.meta.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-medium text-neutral-500 uppercase tracking-wider"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="flex rounded-lg bg-neutral-100 p-1">
                {docTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                      docTab === tab.id
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-700"
                    }`}
                    onClick={() => setDocTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </header>

            {/* Content Container */}
            <div className="flex-1 overflow-auto bg-neutral-50/30">
              <div className="mx-auto min-h-full max-w-5xl bg-white shadow-sm ring-1 ring-neutral-200">
                {docTab === "preview" && (
                  <div className="p-10">
                    <Preview view={codoc.view} data={codoc.data} componentMap={components.componentMap} />
                  </div>
                )}
                {docTab === "data" && (
                  <div className="p-6">
                    <DataPanel data={codoc.data} />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-neutral-400">
            <div className="mb-4 rounded-full bg-neutral-50 p-6 ring-1 ring-neutral-200/50">
              <LogoIcon className="h-12 w-12 text-neutral-200" />
            </div>
            <p className="text-sm font-medium">Select a codoc to begin</p>
            <p className="mt-1 text-xs opacity-60">Your workspace is ready.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Icons ---

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function LogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChatSidebarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
