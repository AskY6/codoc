import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { workspaceRoutes } from "../src/routes/workspace-routes.js";
import { codocRoutes } from "../src/routes/codoc-routes.js";
import { buildRoutes } from "../src/routes/build-routes.js";
import { graphRoutes } from "../src/routes/graph-routes.js";
import type {
  WorkspaceService,
  Workspace,
  WorkspaceListItem,
} from "@cobook/service";

// ---------------------------------------------------------------------------
// In-memory mock WorkspaceService
//
// The routes must not touch repositories directly — they go through the
// service. This mock implements just the methods the routes actually call,
// backed by a tiny in-memory state.
// ---------------------------------------------------------------------------

interface MockState {
  workspaces: Map<string, Workspace>;
  codocs: Map<string, Map<string, { path: string; nodeState: string }>>;
  graphs: Map<
    string,
    {
      nodes: { path: string; nodeState: string }[];
      edges: { from: string; to: string }[];
    }
  >;
}

function createMockService(
  overrides?: Partial<WorkspaceService>,
): WorkspaceService {
  const state: MockState = {
    workspaces: new Map(),
    codocs: new Map(),
    graphs: new Map(),
  };

  const service: WorkspaceService = {
    createWorkspace: async (name) => {
      const ws: Workspace = {
        id: crypto.randomUUID(),
        name,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.workspaces.set(ws.id, ws);
      return ws;
    },
    listWorkspaces: async () => {
      return [...state.workspaces.values()].map(
        (ws): WorkspaceListItem => ({ ...ws, codocCount: 0, agentCount: 0 }),
      );
    },
    getWorkspace: async (id) => state.workspaces.get(id),
    deleteWorkspace: async (id) => {
      state.workspaces.delete(id);
      state.codocs.delete(id);
      state.graphs.delete(id);
    },
    updateWorkspace: async (id, data) => {
      const ws = state.workspaces.get(id);
      if (!ws) throw new Error(`Workspace not found: ${id}`);
      const updated: Workspace = {
        ...ws,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        updatedAt: new Date(),
      };
      state.workspaces.set(id, updated);
      return updated;
    },
    getStatus: async () => ({
      codocCount: 2,
      states: { ready: 1, error: 1 },
    }),
    listCodocs: async (workspaceId) => {
      const bucket = state.codocs.get(workspaceId);
      if (!bucket) return [];
      return [...bucket.values()].map((c) => ({
        id: crypto.randomUUID(),
        path: c.path,
        nodeState: c.nodeState,
        meta: {},
      }));
    },
    build: async () => ({
      ok: true,
      codocCount: 2,
      edgeCount: 1,
      errors: [],
      dag: { nodes: new Map(), edges: [], dependencies: new Map(), dependents: new Map() },
    }),
    resolve: async () => ({ x: 42 }),
    getGraph: async (workspaceId) => {
      return (
        state.graphs.get(workspaceId) ?? {
          nodes: [],
          edges: [],
        }
      );
    },
    createCodoc: async (workspaceId, path) => {
      let bucket = state.codocs.get(workspaceId);
      if (!bucket) {
        bucket = new Map();
        state.codocs.set(workspaceId, bucket);
      }
      bucket.set(path, { path, nodeState: "ready" });
    },
    updateCodoc: async () => {},
    deleteCodoc: async () => {},
    getCodoc: async (_workspaceId, path) => ({
      path,
      content: "",
      ast: { meta: { title: "Test" }, data: { x: { kind: "static" as const, value: 1 } } },
      resolvedData: { [`${path}#data.x`]: 1 },
      nodeState: "ready",
    }),
    getCodocById: async () => undefined,
    patchCodocData: async () => {},
    applyPreset: async () => {},
    createWorkspaceFromPreset: async () => {
      throw new Error("not implemented in mock");
    },
    listPresets: () => [],
    // The mock doesn't exercise the agent runtime, so this can be a stub.
    agentSessionRepo: {
      upsert: async () => {
        throw new Error("not implemented");
      },
      findByWorkspace: async () => undefined,
    },
    ...overrides,
  };

  // Expose the internal seed helpers via symbols on the service object so
  // individual tests can pre-populate state.
  Object.assign(service, { __state: state });
  return service;
}

function seedGraph(
  service: WorkspaceService,
  workspaceId: string,
  graph: {
    nodes: { path: string; nodeState: string }[];
    edges: { from: string; to: string }[];
  },
) {
  const state = (service as unknown as { __state: MockState }).__state;
  state.graphs.set(workspaceId, graph);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Server Routes", () => {
  let app: Hono;
  let service: WorkspaceService;

  beforeEach(() => {
    service = createMockService();
    app = new Hono();
    app.route("/api/workspace", workspaceRoutes(service));
    app.route("/api/workspace", codocRoutes(service));
    app.route("/api/workspace", buildRoutes(service));
    app.route("/api/workspace", graphRoutes(service));
  });

  // -- Workspace routes --

  it("GET /api/workspace returns empty list initially", async () => {
    const res = await app.request("/api/workspace");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/workspace creates a workspace", async () => {
    const res = await app.request("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBeDefined();
  });

  it("POST /api/workspace without name returns 400", async () => {
    const res = await app.request("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/workspace/:id returns 404 for unknown", async () => {
    const res = await app.request("/api/workspace/nonexistent");
    expect(res.status).toBe(404);
  });

  it("GET /api/workspace/:id/status returns status", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codocCount: number };
    expect(body.codocCount).toBe(2);
  });

  it("DELETE /api/workspace/:id removes workspace", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await service.getWorkspace(ws.id)).toBeUndefined();
  });

  // -- Codoc routes --

  it("GET /api/workspace/:id/codocs returns codoc list", async () => {
    const ws = await service.createWorkspace("test");
    await service.createCodoc(ws.id, "a.codoc", "");
    await service.createCodoc(ws.id, "b.codoc", "");

    const res = await app.request(`/api/workspace/${ws.id}/codocs`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ path: string }>;
    expect(list).toHaveLength(2);
  });

  it("GET /api/workspace/:id/codoc/:path returns codoc info", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}/codoc/test.codoc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; nodeState: string };
    expect(body.path).toBe("test.codoc");
    expect(body.nodeState).toBe("ready");
  });

  it("POST /api/workspace/:id/codoc creates a codoc", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}/codoc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.codoc", content: "meta:\n  title: New" }),
    });
    expect(res.status).toBe(201);
  });

  // -- Build routes --

  it("POST /api/workspace/:id/build triggers build", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}/build`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; codocCount: number };
    expect(body.ok).toBe(true);
    expect(body.codocCount).toBe(2);
  });

  it("POST /api/workspace/:id/resolve resolves a node", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: "test.codoc#data.x" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: unknown };
    expect(body.value).toEqual({ x: 42 });
  });

  it("POST /api/workspace/:id/resolve without nodeId returns 400", async () => {
    const ws = await service.createWorkspace("test");
    const res = await app.request(`/api/workspace/${ws.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // -- Graph routes --

  it("GET /api/workspace/:id/graph returns nodes and edges", async () => {
    const ws = await service.createWorkspace("test");
    seedGraph(service, ws.id, {
      nodes: [{ path: "a.codoc", nodeState: "ready" }],
      edges: [{ from: "a.codoc#data.x", to: "b.codoc#data.y" }],
    });

    const res = await app.request(`/api/workspace/${ws.id}/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toHaveLength(1);
  });
});
