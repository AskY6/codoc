// Typed HTTP client for the cobook server API.
// All CLI data operations go through this client.

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ConnectionError extends Error {
  override name = "ConnectionError";
  constructor(public readonly baseUrl: string) {
    super(
      `Cannot connect to cobook server at ${baseUrl}. Is the server running? Try: cobook server start`,
    );
  }
}

export interface ApiClient {
  // Workspace
  listWorkspaces(rootPath?: string): Promise<WorkspaceDTO[]>;
  registerWorkspace(rootPath: string): Promise<WorkspaceDTO>;
  getWorkspace(id: string): Promise<WorkspaceDTO>;
  getWorkspaceStatus(id: string): Promise<WorkspaceStatusDTO>;
  deleteWorkspace(id: string): Promise<void>;

  // Codoc
  listCodocs(workspaceId: string): Promise<CodocSummaryDTO[]>;
  getCodoc(workspaceId: string, path: string): Promise<CodocInfoDTO>;
  createCodoc(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<void>;
  updateCodoc(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<void>;
  deleteCodoc(workspaceId: string, path: string): Promise<void>;

  // Build & Resolve
  build(workspaceId: string): Promise<BuildResultDTO>;
  resolve(workspaceId: string, nodeId: string): Promise<ResolveResultDTO>;

  // Graph
  getGraph(workspaceId: string): Promise<GraphDTO>;

  // Chat
  createThread(workspaceId: string): Promise<ChatThreadDTO>;
  getThread(threadId: string): Promise<ThreadDetailDTO>;
  listThreads(workspaceId: string): Promise<ChatThreadDTO[]>;
  sendMessage(
    threadId: string,
    content: string,
    workspaceId: string,
  ): Promise<Response>;

  // Base URL (for SSE streaming)
  readonly baseUrl: string;
}

// DTO types matching server JSON responses

export interface WorkspaceDTO {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStatusDTO {
  codocCount: number;
  states: Record<string, number>;
}

export interface CodocSummaryDTO {
  path: string;
  nodeState: string;
}

export interface CodocInfoDTO {
  path: string;
  ast: unknown;
  resolvedData: Record<string, unknown> | null;
  nodeState: string;
}

export interface DiagnosticErrorDTO {
  kind: string;
  message: string;
  path?: string;
  nodes?: string[];
}

export interface BuildResultDTO {
  ok: boolean;
  codocCount: number;
  edgeCount: number;
  errors: DiagnosticErrorDTO[];
}

export interface ResolveResultDTO {
  nodeId: string;
  value: unknown;
}

export interface GraphDTO {
  nodes: { path: string; nodeState: string }[];
  edges: { from: string; to: string }[];
}

export interface ChatThreadDTO {
  id: string;
  workspaceId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDTO {
  id: string;
  threadId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface ThreadDetailDTO {
  thread: ChatThreadDTO;
  messages: ChatMessageDTO[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createApiClient(baseUrl: string): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch {
      throw new ConnectionError(baseUrl);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg =
        (body as Record<string, unknown>)["error"] ?? res.statusText;
      throw new ApiError(res.status, String(msg));
    }

    return (await res.json()) as T;
  }

  return {
    // Workspace
    listWorkspaces(rootPath) {
      const qs = rootPath
        ? `?rootPath=${encodeURIComponent(rootPath)}`
        : "";
      return request(`/api/workspace${qs}`);
    },
    registerWorkspace(rootPath) {
      return request("/api/workspace", {
        method: "POST",
        body: JSON.stringify({ rootPath }),
      });
    },
    getWorkspace(id) {
      return request(`/api/workspace/${id}`);
    },
    getWorkspaceStatus(id) {
      return request(`/api/workspace/${id}/status`);
    },
    async deleteWorkspace(id) {
      await request(`/api/workspace/${id}`, { method: "DELETE" });
    },

    // Codoc
    listCodocs(workspaceId) {
      return request(`/api/workspace/${workspaceId}/codocs`);
    },
    getCodoc(workspaceId, path) {
      return request(`/api/workspace/${workspaceId}/codoc/${path}`);
    },
    async createCodoc(workspaceId, path, content) {
      await request(`/api/workspace/${workspaceId}/codoc`, {
        method: "POST",
        body: JSON.stringify({ path, content }),
      });
    },
    async updateCodoc(workspaceId, path, content) {
      await request(`/api/workspace/${workspaceId}/codoc/${path}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
    },
    async deleteCodoc(workspaceId, path) {
      await request(`/api/workspace/${workspaceId}/codoc/${path}`, {
        method: "DELETE",
      });
    },

    // Build & Resolve
    build(workspaceId) {
      return request(`/api/workspace/${workspaceId}/build`, {
        method: "POST",
      });
    },
    resolve(workspaceId, nodeId) {
      return request(`/api/workspace/${workspaceId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ nodeId }),
      });
    },

    // Graph
    getGraph(workspaceId) {
      return request(`/api/workspace/${workspaceId}/graph`);
    },

    // Chat
    createThread(workspaceId) {
      return request("/api/chat/thread", {
        method: "POST",
        body: JSON.stringify({ workspaceId }),
      });
    },
    getThread(threadId) {
      return request(`/api/chat/thread/${threadId}`);
    },
    listThreads(workspaceId) {
      return request(`/api/chat/threads?workspaceId=${encodeURIComponent(workspaceId)}`);
    },
    async sendMessage(threadId, content, workspaceId) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/chat/thread/${threadId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, workspaceId }),
        });
      } catch {
        throw new ConnectionError(baseUrl);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as Record<string, unknown>)["error"] ?? res.statusText;
        throw new ApiError(res.status, String(msg));
      }
      return res;
    },

    baseUrl,
  };
}
