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

export const api = {
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
