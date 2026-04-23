import { useState, useEffect, useCallback } from "react";
import { api } from "./api.ts";
import type { TreeNode, CodocDetail, CodocListItem, DagStatus, WorkspaceInfo, ChatMeta } from "./api.ts";
import { FileTree } from "./components/FileTree.tsx";
import { DocumentPanel } from "./components/DocumentPanel.tsx";
import { GraphPanel } from "./components/GraphPanel.tsx";
import { ComponentPanel } from "./components/ComponentPanel.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { useCustomComponents } from "./custom-components.ts";

// ---------------------------------------------------------------------------
// Focus — what the center panel shows (chat is separate, always right)
// ---------------------------------------------------------------------------

type Focus =
  | { kind: "codoc"; path: string }
  | { kind: "graph" }
  | { kind: "component"; name: string }
  | { kind: "none" };

type SidebarTab = "codocs" | "chats";

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function App() {
  const [wsInfo, setWsInfo] = useState<WorkspaceInfo | null>(null);

  const checkWorkspace = useCallback(async () => {
    try {
      setWsInfo(await api.workspace());
    } catch { /* server not ready */ }
  }, []);

  useEffect(() => {
    void checkWorkspace();
  }, [checkWorkspace]);

  if (!wsInfo) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-100">
        <p className="text-sm text-neutral-400">Connecting...</p>
      </div>
    );
  }

  if (!wsInfo.active) {
    return <WorkspacePicker onOpen={() => void checkWorkspace()} />;
  }

  return <WorkspaceApp workspaceName={wsInfo.name!} onSwitchWorkspace={() => setWsInfo({ active: false })} />;
}

// ---------------------------------------------------------------------------
// Workspace picker
// ---------------------------------------------------------------------------

function WorkspacePicker({ onOpen }: { onOpen: () => void }) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    api.workspaces().then((names) => {
      setWorkspaces(names);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openWorkspace = async (name: string) => {
    setOpening(name);
    try {
      await api.openWorkspace(name);
      onOpen();
    } catch (e) {
      console.error("Failed to open workspace:", e);
      setOpening(null);
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-neutral-100">
      <div className="w-full max-w-md px-6">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-blue-600">codoc</h1>
          <p className="mt-2 text-sm text-neutral-500">Select a workspace</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-neutral-400">Loading...</p>
        ) : workspaces.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-neutral-500">No workspaces found</p>
            <p className="mt-1 text-xs text-neutral-400">
              Create one with: <code className="rounded bg-neutral-100 px-1.5 py-0.5">codoc init &lt;name&gt;</code>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaces.map((name) => (
              <button
                key={name}
                type="button"
                disabled={opening !== null}
                onClick={() => void openWorkspace(name)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md disabled:opacity-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                  <LogoIcon className="h-5 w-5" />
                </span>
                <span className="flex-1 text-sm font-medium text-neutral-800">{name}</span>
                {opening === name && (
                  <span className="text-xs text-neutral-400">Opening...</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function countFiles(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "file") n++;
    else if (node.children) n += countFiles(node.children);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Workspace UI — 3-panel layout
// ---------------------------------------------------------------------------

function WorkspaceApp({ workspaceName, onSwitchWorkspace }: { workspaceName: string; onSwitchWorkspace: () => void }) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [codocList, setCodocList] = useState<CodocListItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [focus, setFocus] = useState<Focus>({ kind: "none" });
  const [codoc, setCodoc] = useState<CodocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dagData, setDagData] = useState<DagStatus | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("codocs");
  const [chatMetas, setChatMetas] = useState<ChatMeta[]>([]);
  const [resumeSession, setResumeSession] = useState<{ sessionId: string; title: string } | undefined>();
  const components = useCustomComponents(0);

  // --- Data loading --------------------------------------------------------

  const loadTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tree");
    }
  }, []);

  const loadCodocs = useCallback(async () => {
    try {
      setCodocList(await api.codocs());
    } catch { /* not critical */ }
  }, []);

  const loadDag = useCallback(async () => {
    try {
      setDagData(await api.dag());
    } catch { /* not critical */ }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      setChatMetas(await api.chats());
    } catch { /* not critical */ }
  }, []);

  useEffect(() => {
    void loadTree();
    void loadDag();
    void loadCodocs();
    void loadChats();
    const id = setInterval(() => { void loadTree(); void loadDag(); void loadCodocs(); void loadChats(); }, 3000);
    return () => clearInterval(id);
  }, [loadTree, loadDag, loadCodocs, loadChats]);

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

  // --- Actions -------------------------------------------------------------

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

  const handleSaveCodoc = useCallback(async (content: string) => {
    if (!codocPath) return;
    await api.writeCodoc(codocPath, content);
  }, [codocPath]);

  const handleNewChat = useCallback(() => {
    setResumeSession(undefined);
    setChatOpen(true);
    setChatKey((k) => k + 1);
  }, []);

  const handleResumeChat = useCallback((meta: ChatMeta) => {
    setResumeSession({ sessionId: meta.sessionId, title: meta.title });
    setChatOpen(true);
    setChatKey((k) => k + 1);
  }, []);

  // --- Sidebar items -------------------------------------------------------

  const fileCount = countFiles(tree);

  const sidebarNav: { id: string; label: string; active: boolean; icon: React.ReactNode; onClick: () => void }[] = [
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
  ];

  // --- Render --------------------------------------------------------------

  return (
    <div className="flex h-screen bg-neutral-100 text-neutral-900 antialiased">
      {/* ── Left Sidebar ─────────────────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
        {/* Workspace header */}
        <div className="border-b border-neutral-200 px-4 py-3">
          <button
            onClick={onSwitchWorkspace}
            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-neutral-200/50"
            title="Switch workspace"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
              {workspaceName.charAt(0).toUpperCase()}
            </span>
            <div className="flex-1 text-left">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">Workspace</div>
              <div className="text-sm font-semibold text-neutral-800 truncate">{workspaceName}</div>
            </div>
            <ChevronDownIcon className="h-4 w-4 text-neutral-300 group-hover:text-neutral-500" />
          </button>
        </div>

        {/* New chat + Search */}
        <div className="space-y-1 px-3 py-2">
          <button
            type="button"
            onClick={handleNewChat}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-200/50"
          >
            <PlusIcon size={16} />
            <span className="font-medium">New chat</span>
          </button>

          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <kbd className="absolute right-2.5 top-1.5 rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-[9px] font-medium text-neutral-400">
              /
            </kbd>
          </div>
        </div>

        {/* Tab switcher: Codocs | Chats */}
        <div className="flex border-b border-neutral-200 px-3">
          <button
            type="button"
            className={`flex-1 py-2 text-center text-xs font-medium transition-colors ${
              sidebarTab === "codocs"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-neutral-400 hover:text-neutral-600"
            }`}
            onClick={() => setSidebarTab("codocs")}
          >
            Codocs <span className="ml-1 text-neutral-400">{fileCount}</span>
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-center text-xs font-medium transition-colors ${
              sidebarTab === "chats"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-neutral-400 hover:text-neutral-600"
            }`}
            onClick={() => setSidebarTab("chats")}
          >
            Chats
          </button>
        </div>

        {/* Tab content */}
        <nav className="flex-1 overflow-auto">
          {sidebarTab === "codocs" ? (
            <>
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Files
                </span>
                <button
                  type="button"
                  onClick={handleNewCodoc}
                  className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200/50 hover:text-neutral-600"
                  title="New Codoc"
                >
                  <PlusIcon size={14} />
                </button>
              </div>
              <div className="px-2 pb-2">
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
              </div>
            </>
          ) : chatMetas.length > 0 ? (
            <div className="px-2 py-2 space-y-0.5">
              {chatMetas.map((meta) => (
                <button
                  key={meta.sessionId}
                  type="button"
                  onClick={() => handleResumeChat(meta)}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-neutral-200/50"
                >
                  <span className="text-sm text-neutral-700 truncate">{meta.title}</span>
                  <span className="text-[10px] text-neutral-400">{formatRelativeTime(meta.lastActiveAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-neutral-400">
              <ChatBubbleIcon className="mb-2 h-8 w-8 opacity-20" />
              <p className="text-xs font-medium">No saved chats yet</p>
              <p className="mt-1 text-[10px] opacity-60">Start a conversation to see it here.</p>
            </div>
          )}
        </nav>

        {/* Bottom nav: Graph / Components */}
        <div className="border-t border-neutral-200 p-2 space-y-0.5">
          {sidebarNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all ${
                item.active
                  ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-200"
                  : "text-neutral-600 hover:bg-neutral-200/50"
              }`}
              onClick={item.onClick}
            >
              <span className={item.active ? "text-white" : "text-neutral-400"}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}

          {/* Chat toggle */}
          <button
            type="button"
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all ${
              chatOpen
                ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-200"
                : "text-neutral-600 hover:bg-neutral-200/50"
            }`}
            onClick={() => setChatOpen((open) => !open)}
          >
            <span className={chatOpen ? "text-white" : "text-neutral-400"}>
              <ChatBubbleIcon />
            </span>
            Chat
          </button>
        </div>
      </aside>

      {/* ── Center + Right ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center: main content panel */}
        <main className="flex flex-1 flex-col overflow-hidden bg-white">
          {error && (
            <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
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

          {focus.kind === "graph" ? (
            <GraphPanel dag={dagData} onSelectCodoc={selectCodoc} />
          ) : focus.kind === "component" ? (
            <ComponentPanel
              builtinRegistry={components.builtinRegistry}
              customRegistry={components.customRegistry}
              errors={components.errors}
            />
          ) : codoc ? (
            <DocumentPanel
              codoc={codoc}
              workspaceName={workspaceName}
              componentMap={components.componentMap}
              onSave={handleSaveCodoc}
              onChat={handleNewChat}
            />
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

        {/* Right: persistent chat panel */}
        {chatOpen && (
          <aside className="w-96 shrink-0">
            <ChatPanel
              key={chatKey}
              codocs={codocList}
              activeCodoc={codocPath}
              onClose={() => setChatOpen(false)}
              resumeSession={resumeSession}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
