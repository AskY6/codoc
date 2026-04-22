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

export async function* streamChat(
  prompt: string,
  sessionId?: string,
  activeCodoc?: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, sessionId, activeCodoc }),
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

export interface WorkspaceInfo {
  active: boolean;
  name?: string;
  codocCount?: number;
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

export const api = {
  /** List available workspace names under ~/.codoc/ */
  workspaces: () => json<string[]>("/api/workspaces"),

  /** Get current workspace status. */
  workspace: () => json<WorkspaceInfo>("/api/workspace"),

  /** Open a workspace by name. */
  openWorkspace: (name: string) =>
    json<{ ok: boolean; codocCount: number }>(`/api/workspaces/${encodeURIComponent(name)}/open`, {
      method: "POST",
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
};
