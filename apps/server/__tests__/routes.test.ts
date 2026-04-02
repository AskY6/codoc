import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { workspaceRoutes } from "../src/routes/workspace-routes.js";
import { codocRoutes } from "../src/routes/codoc-routes.js";
import { buildRoutes } from "../src/routes/build-routes.js";
import { graphRoutes } from "../src/routes/graph-routes.js";
import type {
  WorkspaceService,
  WorkspaceRepository,
  CodocRepository,
  EdgeRepository,
} from "@cobook/service";

// ---------------------------------------------------------------------------
// In-memory mocks
// ---------------------------------------------------------------------------

function createMockWorkspaceRepo(): WorkspaceRepository {
  const store = new Map<string, { id: string; name: string; createdAt: Date; updatedAt: Date }>();
  return {
    async create(data) {
      const ws = {
        id: crypto.randomUUID(),
        name: data.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(ws.id, ws);
      return ws;
    },
    async findById(id) {
      return store.get(id);
    },
    async list() {
      return [...store.values()];
    },
    async delete(id) {
      store.delete(id);
    },
  };
}

function createMockCodocRepo(): CodocRepository {
  const store: Array<{
    id: string;
    workspaceId: string;
    path: string;
    content: string;
    ast: unknown;
    resolvedValue: unknown;
    nodeState: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  return {
    async upsert(workspaceId, path, data) {
      const existing = store.find(
        (r) => r.workspaceId === workspaceId && r.path === path,
      );
      if (existing) {
        if (data.content !== undefined) existing.content = data.content;
        if (data.ast !== undefined) existing.ast = data.ast;
        if (data.resolvedValue !== undefined) existing.resolvedValue = data.resolvedValue;
        if (data.nodeState !== undefined) existing.nodeState = data.nodeState;
        existing.updatedAt = new Date();
        return existing;
      }
      const row = {
        id: crypto.randomUUID(),
        workspaceId,
        path,
        content: data.content ?? "",
        ast: data.ast ?? null,
        resolvedValue: data.resolvedValue ?? null,
        nodeState: data.nodeState ?? "idle",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.push(row);
      return row;
    },
    async findByPath(workspaceId, path) {
      return store.find(
        (r) => r.workspaceId === workspaceId && r.path === path,
      );
    },
    async listByWorkspace(workspaceId) {
      return store.filter((r) => r.workspaceId === workspaceId);
    },
    async delete(workspaceId, path) {
      const idx = store.findIndex(
        (r) => r.workspaceId === workspaceId && r.path === path,
      );
      if (idx >= 0) store.splice(idx, 1);
    },
  };
}

function createMockEdgeRepo(): EdgeRepository {
  const store: Array<{
    id: string;
    workspaceId: string;
    fromNodeId: string;
    toNodeId: string;
    createdAt: Date;
  }> = [];

  return {
    async replaceAll(workspaceId, newEdges) {
      // Remove old
      for (let i = store.length - 1; i >= 0; i--) {
        if (store[i]!.workspaceId === workspaceId) store.splice(i, 1);
      }
      // Add new
      for (const e of newEdges) {
        store.push({
          id: crypto.randomUUID(),
          workspaceId,
          fromNodeId: e.fromNodeId,
          toNodeId: e.toNodeId,
          createdAt: new Date(),
        });
      }
    },
    async listByWorkspace(workspaceId) {
      return store.filter((r) => r.workspaceId === workspaceId);
    },
  };
}

function createMockService(overrides?: Partial<WorkspaceService>): WorkspaceService {
  return {
    createWorkspace: async () => ({
      id: "ws-1",
      name: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getStatus: async () => ({
      codocCount: 2,
      states: { ready: 1, error: 1 },
    }),
    build: async () => ({
      ok: true,
      codocCount: 2,
      edgeCount: 1,
      errors: [],
      dag: { nodes: new Map(), edges: [], dependencies: new Map(), dependents: new Map() },
    }),
    resolve: async () => ({ x: 42 }),
    createCodoc: async () => {},
    updateCodoc: async () => {},
    deleteCodoc: async () => {},
    getCodoc: async () => ({
      path: "test.codoc",
      ast: { meta: { title: "Test" }, data: { x: { kind: "static" as const, value: 1 } } },
      resolvedData: { "test.codoc#data.x": 1 },
      nodeState: "ready",
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Server Routes", () => {
  let app: Hono;
  let wsRepo: WorkspaceRepository;
  let codocRepo: CodocRepository;
  let edgeRepo: EdgeRepository;
  let service: WorkspaceService;

  beforeEach(() => {
    wsRepo = createMockWorkspaceRepo();
    codocRepo = createMockCodocRepo();
    edgeRepo = createMockEdgeRepo();
    service = createMockService();
    app = new Hono();
    app.route("/api/workspace", workspaceRoutes(service, wsRepo));
    app.route("/api/workspace", codocRoutes(service, codocRepo));
    app.route("/api/workspace", buildRoutes(service));
    app.route("/api/workspace", graphRoutes(codocRepo, edgeRepo));
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
    // Create workspace first
    const ws = await wsRepo.create({ name: "test" });
    const res = await app.request(`/api/workspace/${ws.id}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codocCount: number };
    expect(body.codocCount).toBe(2);
  });

  it("DELETE /api/workspace/:id removes workspace", async () => {
    const ws = await wsRepo.create({ name: "test" });
    const res = await app.request(`/api/workspace/${ws.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await wsRepo.findById(ws.id)).toBeUndefined();
  });

  // -- Codoc routes --

  it("GET /api/workspace/:id/codocs returns codoc list", async () => {
    const ws = await wsRepo.create({ name: "test" });
    await codocRepo.upsert(ws.id, "a.codoc", { nodeState: "ready" });
    await codocRepo.upsert(ws.id, "b.codoc", { nodeState: "error" });

    const res = await app.request(`/api/workspace/${ws.id}/codocs`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ path: string }>;
    expect(list).toHaveLength(2);
  });

  it("GET /api/workspace/:id/codoc/:path returns codoc info", async () => {
    const ws = await wsRepo.create({ name: "test" });
    const res = await app.request(`/api/workspace/${ws.id}/codoc/test.codoc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; nodeState: string };
    expect(body.path).toBe("test.codoc");
    expect(body.nodeState).toBe("ready");
  });

  it("POST /api/workspace/:id/codoc creates a codoc", async () => {
    const ws = await wsRepo.create({ name: "test" });
    const res = await app.request(`/api/workspace/${ws.id}/codoc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.codoc", content: "meta:\n  title: New" }),
    });
    expect(res.status).toBe(201);
  });

  // -- Build routes --

  it("POST /api/workspace/:id/build triggers build", async () => {
    const ws = await wsRepo.create({ name: "test" });
    const res = await app.request(`/api/workspace/${ws.id}/build`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; codocCount: number };
    expect(body.ok).toBe(true);
    expect(body.codocCount).toBe(2);
  });

  it("POST /api/workspace/:id/resolve resolves a node", async () => {
    const ws = await wsRepo.create({ name: "test" });
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
    const ws = await wsRepo.create({ name: "test" });
    const res = await app.request(`/api/workspace/${ws.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // -- Graph routes --

  it("GET /api/workspace/:id/graph returns nodes and edges", async () => {
    const ws = await wsRepo.create({ name: "test" });
    await codocRepo.upsert(ws.id, "a.codoc", { nodeState: "ready" });
    await edgeRepo.replaceAll(ws.id, [
      { fromNodeId: "a.codoc#data.x", toNodeId: "b.codoc#data.y" },
    ]);

    const res = await app.request(`/api/workspace/${ws.id}/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toHaveLength(1);
  });
});
