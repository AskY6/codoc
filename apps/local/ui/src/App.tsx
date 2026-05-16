import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "./api.ts";
import type { TreeNode, CodocDetail, CodocListItem, DagStatus, WorkspaceInfo, ChatMeta, ProviderInfo, TemplateInfo, WorkspaceUiSpec } from "./api.ts";
import { FileTree } from "./components/FileTree.tsx";
import { DocumentPanel } from "./components/DocumentPanel.tsx";
import { GraphPanel } from "./components/GraphPanel.tsx";
import { ComponentPanel } from "./components/ComponentPanel.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { SubscriptionsPanel } from "./components/rss/SubscriptionsPanel.tsx";
import { SavedArticlesPanel } from "./components/rss/SavedArticlesPanel.tsx";
import { useCustomComponents } from "./custom-components.ts";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { WorkspaceActionBar } from "./components/WorkspaceActionBar.tsx";
import { subscribe, publish } from "./lib/event-bus.ts";

// ---------------------------------------------------------------------------
// Focus — what the center panel shows (chat is separate, always right)
// ---------------------------------------------------------------------------

type Focus =
  | { kind: "codoc"; path: string }
  | { kind: "graph" }
  | { kind: "component"; name: string }
  | { kind: "plugin-view"; viewId: string }
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

  return <WorkspaceApp wsInfo={wsInfo} onSwitchWorkspace={() => setWsInfo({ active: false })} />;
}

// ---------------------------------------------------------------------------
// Workspace picker
// ---------------------------------------------------------------------------

type PickerDialog =
  | { kind: "template"; template: TemplateInfo }
  | { kind: "create" }
  | { kind: "rename"; oldName: string }
  | { kind: "delete"; name: string };

function WorkspacePicker({ onOpen }: { onOpen: () => void }) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PickerDialog | null>(null);
  const [inputName, setInputName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const [names, tmpls] = await Promise.all([api.workspaces(), api.templates()]);
      setWorkspaces(names);
      setTemplates(tmpls);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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

  const openDialog = (d: PickerDialog) => {
    setDialog(d);
    setDialogError(null);
    setSubmitting(false);
    switch (d.kind) {
      case "template": setInputName(d.template.id); break;
      case "create": setInputName(""); break;
      case "rename": setInputName(d.oldName); break;
      case "delete": setInputName(""); break;
    }
  };

  const closeDialog = () => {
    if (!submitting) setDialog(null);
  };

  const doSubmit = async () => {
    if (!dialog) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      switch (dialog.kind) {
        case "template": {
          await api.createFromTemplate(inputName.trim(), dialog.template.id);
          setDialog(null);
          onOpen();
          return;
        }
        case "create": {
          await api.createWorkspace(inputName.trim());
          await api.openWorkspace(inputName.trim());
          setDialog(null);
          onOpen();
          return;
        }
        case "rename": {
          await api.renameWorkspace(dialog.oldName, inputName.trim());
          setDialog(null);
          await loadList();
          break;
        }
        case "delete": {
          await api.deleteWorkspace(dialog.name);
          setDialog(null);
          await loadList();
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Operation failed";
      setDialogError(msg);
    }
    setSubmitting(false);
  };

  const busy = opening !== null || submitting;

  // Dialog metadata
  const dialogTitle = dialog
    ? dialog.kind === "template" ? `New ${dialog.template.name} workspace`
    : dialog.kind === "create" ? "New workspace"
    : dialog.kind === "rename" ? "Rename workspace"
    : `Delete "${dialog.name}"?`
    : "";

  const dialogDesc = dialog
    ? dialog.kind === "template" ? dialog.template.description
    : dialog.kind === "create" ? "Create an empty workspace"
    : dialog.kind === "rename" ? `Rename "${dialog.oldName}" to a new name`
    : "This will permanently delete the workspace and all its files. This cannot be undone."
    : "";

  const dialogAction = dialog
    ? dialog.kind === "delete" ? "Delete"
    : dialog.kind === "rename" ? "Rename"
    : "Create"
    : "";

  const dialogDanger = dialog?.kind === "delete";

  const needsInput = dialog?.kind !== "delete";

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-neutral-100">
      <div className="w-full max-w-lg px-6">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-blue-600">codoc</h1>
        </div>

        {loading ? (
          <p className="text-center text-sm text-neutral-400">Loading...</p>
        ) : workspaces.length === 0 ? (
          /* ---- Empty state: quick start is the hero ---- */
          <>
            <p className="mb-2 text-sm text-neutral-500">Get started with a template</p>
            <div className="grid grid-cols-2 gap-3">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  disabled={busy}
                  onClick={() => openDialog({ kind: "template", template: tmpl })}
                  className="rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md disabled:opacity-50"
                >
                  <div className="text-sm font-semibold text-neutral-800">{tmpl.name}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">{tmpl.description}</p>
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => openDialog({ kind: "create" })}
              className="mt-4 w-full rounded-lg border border-dashed border-neutral-300 py-2.5 text-sm text-neutral-500 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
            >
              + Empty workspace
            </button>
          </>
        ) : (
          /* ---- Has workspaces: workspace list is primary ---- */
          <>
            <div className="space-y-2">
              {workspaces.map((name) => (
                <div
                  key={name}
                  className="group flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openWorkspace(name)}
                    className="flex flex-1 items-center gap-3 text-left disabled:opacity-50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400">
                      <LogoIcon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm font-medium text-neutral-800">{name}</span>
                    {opening === name && (
                      <span className="text-xs text-neutral-400">Opening...</span>
                    )}
                  </button>
                  {/* Actions (visible on hover) */}
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); openDialog({ kind: "rename", oldName: name }); }}
                      className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                      title="Rename"
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); openDialog({ kind: "delete", name }); }}
                      className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* New workspace actions */}
            <div className="mt-6 border-t border-neutral-200 pt-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openDialog({ kind: "create" })}
                  className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                >
                  + Empty
                </button>
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    disabled={busy}
                    onClick={() => openDialog({ kind: "template", template: tmpl })}
                    className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                  >
                    + {tmpl.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Unified dialog for create / template / rename / delete */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeDialog}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-neutral-800">{dialogTitle}</h2>
            <p className="mt-1 text-xs text-neutral-400">{dialogDesc}</p>

            {needsInput && (
              <>
                <label className="mt-4 block text-xs font-medium text-neutral-500">
                  Workspace name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={inputName}
                  onChange={(e) => { setInputName(e.target.value); setDialogError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void doSubmit(); }}
                  disabled={submitting}
                  className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50"
                  placeholder="my-workspace"
                />
              </>
            )}

            {dialogError && (
              <p className="mt-2 text-xs text-red-500">{dialogError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={closeDialog}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || (needsInput && !inputName.trim())}
                onClick={() => void doSubmit()}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                  dialogDanger
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {submitting ? "..." : dialogAction}
              </button>
            </div>
          </div>
        </div>
      )}
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

function WorkspaceApp({ wsInfo, onSwitchWorkspace }: { wsInfo: WorkspaceInfo; onSwitchWorkspace: () => void }) {
  const workspaceName = wsInfo.name!;
  const uiSpec: WorkspaceUiSpec | undefined = wsInfo.uiSpec;
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
  const [resumeSession, setResumeSession] = useState<{ sessionId: string; title: string; provider?: string } | undefined>();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [chatProvider, setChatProvider] = useState<string>(() =>
    localStorage.getItem("codoc:lastProvider") ?? "claude-code",
  );
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "codoc"; path: string } | { kind: "chat"; sessionId: string; title: string } | null>(null);
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
      const next = await api.dag();
      setDagData((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
    } catch { /* not critical */ }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      setChatMetas(await api.chats());
    } catch { /* not critical */ }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const list = await api.providers();
      setProviders(list);
      // Default to first available provider
      const first = list.find((p) => p.available);
      if (first) setChatProvider((prev) => {
        // Only set default if current selection is not available
        const current = list.find((p) => p.id === prev && p.available);
        return current ? prev : first.id;
      });
    } catch { /* not critical */ }
  }, []);

  useEffect(() => {
    void loadTree();
    void loadDag();
    void loadCodocs();
    void loadChats();
    void loadProviders();

    // SSE push — reload on backend data changes.
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/updates");
      es.onmessage = () => {
        void loadTree(); void loadDag(); void loadCodocs(); void loadChats();
        publish("workspace-updated", {});
      };
    } catch { /* SSE unsupported — fall through to polling */ }

    // Fallback polling at a relaxed 10s cadence.
    const id = setInterval(() => { void loadTree(); void loadDag(); void loadCodocs(); void loadChats(); }, 10_000);
    return () => { clearInterval(id); es?.close(); };
  }, [loadTree, loadDag, loadCodocs, loadChats, loadProviders]);

  // Load codoc detail when a codoc is focused
  const codocPath = focus.kind === "codoc" ? focus.path : null;

  const fetchCodoc = useCallback(async (path: string) => {
    try {
      const c = await api.codoc(path);
      setCodoc((prev) => {
        if (!prev || prev.path !== c.path) return c;
        // Compare both raw content and resolved data to catch all update paths
        // (static field patches change content; source cache updates change data).
        if (prev.content === c.content && JSON.stringify(prev.data) === JSON.stringify(c.data)) return prev;
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

    // SSE-driven refresh for the focused codoc.
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/updates");
      es.onmessage = () => void fetchCodoc(codocPath);
    } catch { /* fallback below */ }

    const id = setInterval(() => void fetchCodoc(codocPath), 10_000);
    return () => { clearInterval(id); es?.close(); };
  }, [codocPath, fetchCodoc]);

  // --- Actions -------------------------------------------------------------

  const selectCodoc = useCallback((path: string) => {
    setFocus({ kind: "codoc", path });
  }, []);

  // Auto-select inbox on first mount when plugin declares homeView: "inbox".
  const didAutoFocus = useRef(false);
  useEffect(() => {
    if (didAutoFocus.current || uiSpec?.homeView !== "inbox") return;
    if (tree.length === 0) return; // wait for tree to load
    didAutoFocus.current = true;
    const hasInbox = codocList.some((c) => c.path === "inbox.codoc");
    if (hasInbox) {
      selectCodoc("inbox.codoc");
    }
  }, [tree, codocList, uiSpec, selectCodoc]);

  const requestDeleteCodoc = useCallback((path: string) => {
    setPendingDelete({ kind: "codoc", path });
  }, []);

  const requestDeleteChat = useCallback((sessionId: string, title: string) => {
    setPendingDelete({ kind: "chat", sessionId, title });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setPendingDelete(null);
    try {
      if (pendingDelete.kind === "codoc") {
        await api.deleteCodoc(pendingDelete.path);
        if (focus.kind === "codoc" && focus.path === pendingDelete.path) {
          setFocus({ kind: "none" });
        }
        await loadTree();
        await loadCodocs();
        await loadDag();
      } else {
        await api.deleteChat(pendingDelete.sessionId);
        await loadChats();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }, [pendingDelete, focus, loadTree, loadCodocs, loadDag, loadChats]);

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

  const startChat = useCallback((providerId: string) => {
    setChatProvider(providerId);
    localStorage.setItem("codoc:lastProvider", providerId);
    setResumeSession(undefined);
    setChatOpen(true);
    setChatKey((k) => k + 1);
  }, []);

  // --- Pending prompt (from event bus, e.g. <Prompt> component) ------------
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();

  const handleNewChat = useCallback(() => {
    // Use remembered default provider directly — no picker
    const available = providers.filter((p) => p.available);
    if (available.length === 0) return;
    const defaultAvailable = available.find((p) => p.id === chatProvider);
    startChat(defaultAvailable ? chatProvider : available[0]!.id);
  }, [providers, chatProvider, startChat]);

  // Subscribe to event bus — open chat and forward prompt
  const handleNewChatRef = useRef(handleNewChat);
  handleNewChatRef.current = handleNewChat;
  useEffect(() => {
    return subscribe("send-prompt", ({ prompt }) => {
      setPendingPrompt(prompt);
      handleNewChatRef.current();
    });
  }, []);

  // Expose a small API on window so custom workspace components (which can't
  // import the event bus directly) can open a chat with article context.
  useEffect(() => {
    interface DiscussArticle {
      title?: string;
      source?: string;
      link?: string;
    }
    const w = window as unknown as { codoc?: { discuss(a: DiscussArticle): Promise<void> } };
    w.codoc = {
      discuss: async ({ title, source, link }) => {
        if (!link) return;
        let body = "";
        try {
          body = (await api.rss.discuss(link)).body ?? "";
        } catch (e) {
          console.warn("[discuss] fetch failed", e);
        }
        const header = `**${title ?? "Untitled"}** — ${source ?? ""}\n${link}`;
        const prompt = body
          ? `I want to discuss this article. Read it carefully, then say "Ready — what would you like to know?" and wait for my questions.\n\n${header}\n\n---\n\n${body}`
          : `I want to discuss this article, but I couldn't fetch its full text. Use the title and link, then say "Ready — what would you like to know?" and wait.\n\n${header}`;
        publish("send-prompt", { prompt });
      },
    };
    return () => {
      delete w.codoc;
    };
  }, []);

  const handlePickProvider = useCallback((id: string) => {
    setShowProviderPicker(false);
    startChat(id);
  }, [startChat]);

  const handleResumeChat = useCallback((meta: ChatMeta) => {
    const pid = meta.provider ?? "claude-code";
    setChatProvider(pid);
    localStorage.setItem("codoc:lastProvider", pid);
    setResumeSession({ sessionId: meta.sessionId, title: meta.title, provider: meta.provider });
    setChatOpen(true);
    setChatKey((k) => k + 1);
  }, []);

  // --- Filtered tree (apply plugin hiddenPaths) ----------------------------

  const visibleTree = useMemo(() => {
    const hidden = uiSpec?.hiddenPaths;
    if (!hidden || hidden.length === 0) return tree;
    const hiddenSet = new Set(hidden);
    // Tree nodes use .mdx names (compiled output); hiddenPaths use .codoc names.
    // Normalize by checking both the raw path and a .mdx→.codoc variant.
    function isHidden(treePath: string): boolean {
      if (hiddenSet.has(treePath)) return true;
      if (treePath.endsWith(".mdx")) {
        return hiddenSet.has(treePath.replace(/\.mdx$/, ".codoc"));
      }
      return false;
    }
    function filterNodes(nodes: TreeNode[], prefix = ""): TreeNode[] {
      return nodes
        .filter((n) => {
          const fullPath = prefix ? `${prefix}/${n.name}` : n.name;
          return !isHidden(fullPath);
        })
        .map((n) => {
          const fullPath = prefix ? `${prefix}/${n.name}` : n.name;
          return n.children ? { ...n, children: filterNodes(n.children, fullPath) } : n;
        });
    }
    return filterNodes(tree);
  }, [tree, uiSpec]);

  // --- Sidebar items -------------------------------------------------------

  const fileCount = countFiles(visibleTree);

  const viewIconMap: Record<string, React.ReactNode> = {
    list: <ListIcon />,
    bookmark: <BookmarkIcon />,
    rss: <RssIcon />,
  };

  const sidebarNav: { id: string; label: string; active: boolean; icon: React.ReactNode; onClick: () => void }[] = [
    ...(uiSpec?.secondaryViews ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      active: focus.kind === "plugin-view" && focus.viewId === v.id,
      icon: viewIconMap[v.icon ?? ""] ?? <RssIcon />,
      onClick: () => setFocus({ kind: "plugin-view", viewId: v.id }),
    })),
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

        {/* Search */}
        <div className="px-3 py-2">
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
            Chats{chatMetas.length > 0 && <span className="ml-1 text-neutral-400">{chatMetas.length}</span>}
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
                {visibleTree.length > 0 ? (
                  <FileTree
                    tree={visibleTree}
                    selectedPath={codocPath}
                    onSelect={selectCodoc}
                    onDelete={requestDeleteCodoc}
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
          ) : (
            <>
              {/* New chat button + provider selector */}
              <div className="px-3 py-2 space-y-1.5">
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <PlusIcon size={14} />
                  <span className="flex-1 text-left">New chat</span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                    {providers.find((p) => p.id === chatProvider)?.name ?? chatProvider}
                  </span>
                </button>
                {providers.filter((p) => p.available).length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowProviderPicker(true)}
                    className="w-full rounded-md px-3 py-1 text-[10px] text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                  >
                    Switch provider
                  </button>
                )}
              </div>

              {/* Chat history */}
              {chatMetas.length > 0 ? (
                <div className="px-2 space-y-0.5">
                  {chatMetas.map((meta) => (
                    <div
                      key={meta.sessionId}
                      className="group flex w-full items-center rounded-lg px-3 py-2 transition-colors hover:bg-neutral-200/50"
                    >
                      <button
                        type="button"
                        onClick={() => handleResumeChat(meta)}
                        className="flex flex-1 flex-col gap-0.5 text-left min-w-0"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-neutral-700 truncate flex-1">{meta.title}</span>
                          {meta.provider && meta.provider !== "claude-code" && (
                            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-medium text-neutral-400">
                              {providers.find((p) => p.id === meta.provider)?.name ?? meta.provider}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-neutral-400">{formatRelativeTime(meta.lastActiveAt)}</span>
                      </button>
                      <button
                        type="button"
                        className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-100 hover:text-red-500"
                        title="Delete chat"
                        onClick={(e) => {
                          e.stopPropagation();
                          requestDeleteChat(meta.sessionId, meta.title);
                        }}
                      >
                        <XIcon />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-neutral-400">
                  <ChatBubbleIcon className="mb-2 h-8 w-8 opacity-20" />
                  <p className="text-xs font-medium">No saved chats yet</p>
                  <p className="mt-1 text-[10px] opacity-60">Start a conversation to see it here.</p>
                </div>
              )}
            </>
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

          {uiSpec?.primaryActions && uiSpec.primaryActions.length > 0 && (
            <WorkspaceActionBar
              actions={uiSpec.primaryActions}
              onActionComplete={() => { if (codocPath) void fetchCodoc(codocPath); }}
            />
          )}

          {focus.kind === "graph" ? (
            <GraphPanel dag={dagData} onSelectCodoc={selectCodoc} />
          ) : focus.kind === "component" ? (
            <ComponentPanel
              builtinRegistry={components.builtinRegistry}
              customRegistry={components.customRegistry}
              errors={components.errors}
            />
          ) : focus.kind === "plugin-view" && focus.viewId === "rss-subscriptions" ? (
            <SubscriptionsPanel onSelectCodoc={selectCodoc} />
          ) : focus.kind === "plugin-view" && focus.viewId === "rss-saved" ? (
            <SavedArticlesPanel />
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
              pluginId={wsInfo.pluginId}
              onClose={() => setChatOpen(false)}
              resumeSession={resumeSession}
              provider={chatProvider}
              providerName={providers.find((p) => p.id === chatProvider)?.name}
              initialPrompt={pendingPrompt}
              onPromptConsumed={() => setPendingPrompt(undefined)}
            />
          </aside>
        )}

        {/* Delete confirmation dialog */}
        <ConfirmDialog
          open={pendingDelete !== null}
          title={pendingDelete?.kind === "codoc" ? "Delete codoc" : "Delete chat"}
          description={
            pendingDelete?.kind === "codoc"
              ? `"${pendingDelete.path}" will be permanently deleted. This cannot be undone.`
              : pendingDelete?.kind === "chat"
                ? `"${pendingDelete.title}" will be permanently deleted. This cannot be undone.`
                : ""
          }
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />

        {/* Provider picker overlay */}
        {showProviderPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="w-80 rounded-xl border border-neutral-200 bg-white p-5 shadow-xl">
              <h3 className="text-sm font-semibold text-neutral-800 mb-3">Choose a provider</h3>
              <div className="space-y-2">
                {providers.filter((p) => p.available).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePickProvider(p.id)}
                    className="flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50"
                  >
                    <ProviderIcon id={p.id} />
                    <span className="text-sm font-medium text-neutral-800">{p.name}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowProviderPicker(false)}
                className="mt-3 w-full rounded-lg py-2 text-xs text-neutral-400 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
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

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
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

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ProviderIcon({ id }: { id: string }) {
  const colors: Record<string, string> = {
    "claude-code": "bg-amber-100 text-amber-600",
    "codex": "bg-emerald-100 text-emerald-600",
    "kiro": "bg-violet-100 text-violet-600",
  };
  const cls = colors[id] ?? "bg-neutral-100 text-neutral-500";
  const label = id.charAt(0).toUpperCase();
  return (
    <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${cls}`}>
      {label}
    </span>
  );
}
