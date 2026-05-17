// Typed API client for the local codoc REST endpoints.

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export interface CodocListItem {
  path: string;
  title: string | null;
  tags: string[];
  dataFieldCount: number;
  hasView: boolean;
}

export interface ResolvedField {
  kind: "ready" | "error";
  value?: unknown;
  error?: { message: string };
}

export interface DataFieldInfo {
  kind: "static" | "ref" | "source";
  resolved: ResolvedField | null;
}

export interface CodocDetail {
  path: string;
  content: string;
  meta: {
    title: string | null;
    description: string | null;
    tags: string[];
  };
  view: { kind: "mdx"; source: string } | { kind: "empty" };
  data: Record<string, DataFieldInfo>;
}

export type CustomComponentEntry =
  | { kind: "ok"; name: string; code: string }
  | { kind: "error"; name: string; error: string };

export interface EnhancementSuggestion {
  name: string;
  template: string;
  isBuiltin: boolean;
}

export interface Enhancement {
  field: string;
  valueType: string;
  currentUsage: "not-referenced" | "raw-expression" | "already-enhanced";
  suggestions: EnhancementSuggestion[];
  reason: string;
}

export interface DagNode {
  id: string;
  codocPath: string;
  fieldName: string;
  kind: "static" | "ref" | "source";
}

export interface DagEdge {
  from: string;
  to: string;
}

export interface DagCodoc {
  path: string;
  title: string | null;
  tags: string[];
  fields: string[];
}

export interface DagStatus {
  ok: boolean;
  nodeCount?: number;
  edgeCount?: number;
  cycles?: string[][];
  unknownTargets?: Array<{ from: string; target: string }>;
  nodes?: DagNode[];
  edges?: DagEdge[];
  codocs?: DagCodoc[];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Chat SSE — streams ChatEvent from the Claude Code SDK proxy
// ---------------------------------------------------------------------------

export type ChatEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; name: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result?: string; costUsd?: number };

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface ImageAttachment {
  dataUrl: string;
  name: string;
}

export async function* streamChat(
  prompt: string,
  sessionId?: string,
  mentions?: string[],
  images?: ImageAttachment[],
  signal?: AbortSignal,
  provider?: string,
): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, prompt, sessionId, mentions, images }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete line
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          yield JSON.parse(line.slice(6)) as ChatEvent;
        } catch { /* ignore malformed */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace management
// ---------------------------------------------------------------------------

export interface WorkspaceUiViewDescriptor {
  id: string;
  label: string;
  icon?: string;
}

export interface WorkspaceUiSpec {
  homeView?: "tree" | "inbox";
  homeCodocPath?: string;
  hiddenPaths?: string[];
  secondaryViews?: WorkspaceUiViewDescriptor[];
}

export interface WorkspaceCommandDescriptor {
  id: string;
  title: string;
  category?: string;
  icon?: string;
}

export interface WorkspaceMenuItem {
  command: string;
  when?: string;
  group?: string;
}

export interface WorkspaceMenus {
  "workspace.actionBar"?: WorkspaceMenuItem[];
  commandPalette?: WorkspaceMenuItem[];
  "view.title"?: WorkspaceMenuItem[];
  "fileTree.context"?: WorkspaceMenuItem[];
}

export interface WorkspaceMdxComponentDescriptor {
  name: string;
  path: string;
}

export interface AllPluginCommandDescriptor extends WorkspaceCommandDescriptor {
  pluginId: string;
}

export interface WorkspaceInfo {
  active: boolean;
  name?: string;
  codocCount?: number;
  pluginId?: string;
  uiSpec?: WorkspaceUiSpec;
  commands?: WorkspaceCommandDescriptor[];
  menus?: WorkspaceMenus;
  mdxComponents?: WorkspaceMdxComponentDescriptor[];
  /** Phase 5: commands from every installed plugin, tagged with pluginId. */
  allCommands?: AllPluginCommandDescriptor[];
  /**
   * Typed plugin config, same shape the server-side `activate(ctx).config`
   * received. UI plugin code reads it via `UiActivateContext.config`. Must
   * be JSON-serializable — plugins keep config to primitives.
   */
  pluginConfig?: unknown;
}

export interface ChatMeta {
  sessionId: string;
  provider: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  mentions: string[];
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: { name: string; status: "done" }[];
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export interface WorkspaceConfig {
  port?: number;
  /** RSS feed refresh interval in minutes (default 30). */
  refreshInterval?: number;
  commands?: Array<{ name: string; description: string; prompt: string }>;
  quickActions?: Array<{ label: string; prompt: string }>;
  agentInstructions?: string;
}

// ---------------------------------------------------------------------------
// RSS plugin types
// ---------------------------------------------------------------------------

export type RssFeedStatus = "healthy" | "failing" | "never-fetched";

export interface RssSubscription {
  slug: string;
  title: string;
  feedUrl: string;
  whyFollow: string;
  codocPath: string;
  intervalMinutes: number;
  articleCount: number;
  unreadCount: number;
  starredCount: number;
  lastFetchedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  status: RssFeedStatus;
}

export interface RssArticle {
  articleId?: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  readAt?: string | null;
  starred?: boolean;
}

export interface RssStarredArticle extends RssArticle {
  sourceSlug: string;
  sourceTitle: string;
}

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

export const api = {
  /** Workspace config (includes template interaction metadata). */
  config: () => json<WorkspaceConfig>("/api/config"),

  /** Update workspace config fields (partial merge). */
  updateConfig: (patch: Partial<WorkspaceConfig>) =>
    json<{ ok: boolean; config: WorkspaceConfig }>("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  /** List available CLI providers. */
  providers: () => json<ProviderInfo[]>("/api/providers"),

  /** List available workspace names under ~/.codoc/ */
  workspaces: () => json<string[]>("/api/workspaces"),

  /** Get current workspace status. */
  workspace: () => json<WorkspaceInfo>("/api/workspace"),

  /** Open a workspace by name. */
  openWorkspace: (name: string) =>
    json<{ ok: boolean; codocCount: number }>(`/api/workspaces/${encodeURIComponent(name)}/open`, {
      method: "POST",
    }),

  /** Create an empty workspace. */
  createWorkspace: (name: string) =>
    json<{ ok: boolean; name: string }>("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  /** Delete a workspace. */
  deleteWorkspace: (name: string) =>
    json<{ ok: boolean }>(`/api/workspaces/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  /** Rename a workspace. */
  renameWorkspace: (oldName: string, newName: string) =>
    json<{ ok: boolean; name: string }>(`/api/workspaces/${encodeURIComponent(oldName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    }),

  /** List available workspace templates. */
  templates: () => json<TemplateInfo[]>("/api/templates"),

  /** Create a workspace from a template and open it. */
  createFromTemplate: (name: string, templateId: string) =>
    json<{ ok: boolean; name: string; codocCount: number }>("/api/workspaces/from-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, templateId }),
    }),

  tree: () => json<TreeNode[]>("/api/tree"),

  codocs: () => json<CodocListItem[]>("/api/codocs"),

  codoc: (path: string) => json<CodocDetail>(`/api/codoc/${encodeURI(path)}`),

  writeCodoc: (path: string, content: string) =>
    json<{ ok: boolean; error?: string }>(`/api/codoc/${encodeURI(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),

  deleteCodoc: (path: string) =>
    json<{ ok: boolean }>(`/api/codoc/${encodeURI(path)}`, {
      method: "DELETE",
    }),

  components: () => json<CustomComponentEntry[]>("/api/components"),

  dag: () => json<DagStatus>("/api/dag"),

  enhancements: (path: string) =>
    json<Enhancement[]>(`/api/codoc/${encodeURI(path)}/enhancements`),

  /** List chat metadata sorted by most recent. */
  chats: () => json<ChatMeta[]>("/api/chats"),

  /** Load session message history for a chat. */
  chatMessages: (sessionId: string) =>
    json<SessionMessage[]>(`/api/chats/${encodeURIComponent(sessionId)}/messages`),

  /** Delete a chat meta entry by session ID. */
  deleteChat: (sessionId: string) =>
    json<{ ok: boolean }>(`/api/chats/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),

  /** Update a single article's read/starred state within a source field. */
  updateArticle: (codocPath: string, field: string, index: number, patch: { readAt?: string | null; starred?: boolean }) =>
    json<{ ok: boolean }>(`/api/codoc/${encodeURI(codocPath)}/articles/${encodeURIComponent(field)}/${index}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  // ── RSS plugin ──────────────────────────────────────────────────────────

  rss: {
    subscriptions: () =>
      json<{ ok: boolean; subscriptions: RssSubscription[] }>("/api/plugins/rss/subscriptions")
        .then((r) => r.subscriptions),

    subscribe: (input: { url: string; title?: string; whyFollow?: string; intervalMinutes?: number }) =>
      json<{ ok: boolean; slug: string; codocPath: string }>("/api/plugins/rss/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),

    editSubscription: (slug: string, input: { title?: string; whyFollow?: string; intervalMinutes?: number }) =>
      json<{ ok: boolean }>(`/api/plugins/rss/subscriptions/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),

    deleteSubscription: (slug: string) =>
      json<{ ok: boolean }>(`/api/plugins/rss/subscriptions/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      }),

    refreshFeed: (slug: string) =>
      json<{ ok: boolean }>(`/api/plugins/rss/subscriptions/${encodeURIComponent(slug)}/refresh`, {
        method: "POST",
      }),

    refreshAll: () =>
      json<{ ok: boolean; message: string; total: number }>("/api/plugins/rss/refresh", {
        method: "POST",
      }),

    saved: () =>
      json<{ ok: boolean; articles: RssStarredArticle[] }>("/api/plugins/rss/saved")
        .then((r) => r.articles),

    updateArticle: (articleId: string, patch: { readAt?: string | null; starred?: boolean }) =>
      json<{ ok: boolean }>(`/api/plugins/rss/articles/${encodeURIComponent(articleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),

    discuss: (link: string) =>
      json<{ ok: boolean; body: string }>("/api/plugins/rss/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      }),
  },
};
