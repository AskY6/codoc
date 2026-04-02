import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { findWorkspaceRoot } from "../src/workspace-discovery.js";
import {
  createApiClient,
  ApiError,
  ConnectionError,
  type ApiClient,
} from "../src/api-client.js";

// ---------------------------------------------------------------------------
// Mock server — verifies the API client sends correct requests and that
// responses are parsed into the right DTO shapes. No filesystem concepts.
// ---------------------------------------------------------------------------

function createMockServer() {
  const app = new Hono();

  // In-memory stores — no filesystem paths, just opaque identifiers
  const workspaces = new Map<string, Record<string, unknown>>();
  const codocs = new Map<string, Record<string, unknown>>();

  // Seed
  workspaces.set("ws-1", {
    id: "ws-1",
    name: "seed-workspace",
    rootPath: "opaque-root-1",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
  codocs.set("a.codoc", {
    path: "a.codoc",
    nodeState: "ready",
    ast: { meta: { title: "A" }, data: { x: { kind: "static", value: 1 } } },
    resolvedData: { "a.codoc#data.x": 1 },
  });
  codocs.set("sub/b.codoc", {
    path: "sub/b.codoc",
    nodeState: "dirty",
    ast: { meta: { title: "B" } },
    resolvedData: null,
  });

  // --- Workspace ---
  app.get("/api/workspace", (c) => {
    const rootPath = c.req.query("rootPath");
    const list = [...workspaces.values()];
    if (rootPath) return c.json(list.filter((w) => w["rootPath"] === rootPath));
    return c.json(list);
  });

  app.post("/api/workspace", async (c) => {
    const body = await c.req.json<{ rootPath: string }>();
    if (!body.rootPath) return c.json({ error: "rootPath is required" }, 400);
    const id = `ws-${workspaces.size + 1}`;
    const ws = { id, name: "created", rootPath: body.rootPath, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    workspaces.set(id, ws);
    return c.json(ws, 201);
  });

  app.get("/api/workspace/:id", (c) => {
    const ws = workspaces.get(c.req.param("id"));
    if (!ws) return c.json({ error: "Not found" }, 404);
    return c.json(ws);
  });

  app.get("/api/workspace/:id/status", (c) => {
    if (!workspaces.has(c.req.param("id"))) return c.json({ error: "Not found" }, 404);
    return c.json({ codocCount: codocs.size, states: { ready: 1, dirty: 1 } });
  });

  app.delete("/api/workspace/:id", (c) => {
    workspaces.delete(c.req.param("id"));
    return c.json({ ok: true });
  });

  // --- Codoc ---
  app.get("/api/workspace/:id/codocs", (c) => {
    if (!workspaces.has(c.req.param("id"))) return c.json({ error: "Not found" }, 404);
    return c.json([...codocs.values()].map((d) => ({ path: d["path"], nodeState: d["nodeState"] })));
  });

  app.get("/api/workspace/:id/codoc/*", (c) => {
    const codocPath = c.req.path.replace(new RegExp(`^.*/workspace/${c.req.param("id")}/codoc/`), "");
    const codoc = codocs.get(codocPath);
    if (!codoc) return c.json({ error: "Codoc not found" }, 404);
    return c.json(codoc);
  });

  app.post("/api/workspace/:id/codoc", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>();
    codocs.set(body.path, { path: body.path, nodeState: "idle", ast: null, resolvedData: null });
    return c.json({ ok: true }, 201);
  });

  app.put("/api/workspace/:id/codoc/*", async (c) => {
    const codocPath = c.req.path.replace(new RegExp(`^.*/workspace/${c.req.param("id")}/codoc/`), "");
    if (!codocs.has(codocPath)) return c.json({ error: "Codoc not found" }, 404);
    return c.json({ ok: true });
  });

  app.delete("/api/workspace/:id/codoc/*", (c) => {
    const codocPath = c.req.path.replace(new RegExp(`^.*/workspace/${c.req.param("id")}/codoc/`), "");
    codocs.delete(codocPath);
    return c.json({ ok: true });
  });

  // --- Build / Resolve ---
  app.post("/api/workspace/:id/build", (c) => {
    if (!workspaces.has(c.req.param("id"))) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true, codocCount: codocs.size, edgeCount: 1, errors: [] });
  });

  app.post("/api/workspace/:id/resolve", async (c) => {
    const body = await c.req.json<{ nodeId: string }>();
    if (!body.nodeId) return c.json({ error: "nodeId is required" }, 400);
    return c.json({ nodeId: body.nodeId, value: 42 });
  });

  // --- Graph ---
  app.get("/api/workspace/:id/graph", (c) => {
    if (!workspaces.has(c.req.param("id"))) return c.json({ error: "Not found" }, 404);
    return c.json({
      nodes: [...codocs.values()].map((d) => ({ path: d["path"], nodeState: d["nodeState"] })),
      edges: [{ from: "a.codoc#data.x", to: "sub/b.codoc#data.y" }],
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let server: ReturnType<typeof serve>;
let client: ApiClient;
const PORT = 39_123;

beforeAll(async () => {
  server = serve({ fetch: createMockServer().fetch, port: PORT });
  client = createApiClient(`http://localhost:${PORT}`);
  await new Promise((r) => setTimeout(r, 200));
});

afterAll(() => { server.close(); });

// ---------------------------------------------------------------------------
// Workspace — request correctness & response shape
// ---------------------------------------------------------------------------

describe("ApiClient — workspace", () => {
  it("listWorkspaces sends GET /api/workspace and parses list", async () => {
    const list = await client.listWorkspaces();
    expect(list).toHaveLength(1);
    // Verify DTO shape — id, name, rootPath, timestamps all present
    const ws = list[0]!;
    expect(ws).toHaveProperty("id");
    expect(ws).toHaveProperty("name");
    expect(ws).toHaveProperty("rootPath");
    expect(ws).toHaveProperty("createdAt");
  });

  it("listWorkspaces passes rootPath as query param and filters correctly", async () => {
    const match = await client.listWorkspaces("opaque-root-1");
    expect(match).toHaveLength(1);

    const noMatch = await client.listWorkspaces("nonexistent-root");
    expect(noMatch).toHaveLength(0);
  });

  it("registerWorkspace sends POST with rootPath and returns created DTO", async () => {
    const ws = await client.registerWorkspace("any-string");
    expect(ws).toHaveProperty("id");
    expect(ws.rootPath).toBe("any-string"); // server echoes what client sent
  });

  it("getWorkspace sends GET /api/workspace/:id", async () => {
    const ws = await client.getWorkspace("ws-1");
    expect(ws).toHaveProperty("id", "ws-1");
    expect(ws).toHaveProperty("name");
  });

  it("getWorkspace throws ApiError 404 for unknown id", async () => {
    const err = await client.getWorkspace("unknown").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });

  it("getWorkspaceStatus returns codocCount and states map", async () => {
    const status = await client.getWorkspaceStatus("ws-1");
    expect(typeof status.codocCount).toBe("number");
    expect(status.states).toHaveProperty("ready");
    expect(status.states).toHaveProperty("dirty");
  });

  it("deleteWorkspace sends DELETE and does not throw", async () => {
    const ws = await client.registerWorkspace("to-delete");
    await expect(client.deleteWorkspace(ws.id)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Codoc — URL construction (esp. nested paths) & response parsing
// ---------------------------------------------------------------------------

describe("ApiClient — codoc", () => {
  it("listCodocs returns array of {path, nodeState}", async () => {
    const list = await client.listCodocs("ws-1");
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const item of list) {
      expect(item).toHaveProperty("path");
      expect(item).toHaveProperty("nodeState");
    }
  });

  it("getCodoc constructs correct URL for flat path", async () => {
    const info = await client.getCodoc("ws-1", "a.codoc");
    expect(info).toHaveProperty("path", "a.codoc");
    expect(info).toHaveProperty("nodeState");
    expect(info).toHaveProperty("ast");
    expect(info).toHaveProperty("resolvedData");
  });

  it("getCodoc constructs correct URL for nested path (sub/b.codoc)", async () => {
    const info = await client.getCodoc("ws-1", "sub/b.codoc");
    expect(info).toHaveProperty("path", "sub/b.codoc");
  });

  it("getCodoc throws ApiError 404 for missing codoc", async () => {
    const err = await client.getCodoc("ws-1", "nope.codoc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });

  it("createCodoc sends POST body with path+content, codoc appears in list", async () => {
    await client.createCodoc("ws-1", "created.codoc", "meta:\n  title: X");
    const list = await client.listCodocs("ws-1");
    expect(list.some((c) => c.path === "created.codoc")).toBe(true);
  });

  it("updateCodoc sends PUT to codoc wildcard URL", async () => {
    await expect(
      client.updateCodoc("ws-1", "a.codoc", "meta:\n  title: Updated"),
    ).resolves.toBeUndefined();
  });

  it("deleteCodoc sends DELETE, codoc no longer retrievable", async () => {
    await client.createCodoc("ws-1", "temp.codoc", "x");
    await client.deleteCodoc("ws-1", "temp.codoc");
    const err = await client.getCodoc("ws-1", "temp.codoc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// Build & Resolve — POST bodies and response shapes
// ---------------------------------------------------------------------------

describe("ApiClient — build & resolve", () => {
  it("build sends POST and returns {ok, codocCount, edgeCount, errors}", async () => {
    const result = await client.build("ws-1");
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.codocCount).toBe("number");
    expect(typeof result.edgeCount).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("resolve sends nodeId in POST body and returns {nodeId, value}", async () => {
    const result = await client.resolve("ws-1", "a.codoc#data.x");
    expect(result.nodeId).toBe("a.codoc#data.x"); // server echoes what client sent
    expect(result.value).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Graph — response shape
// ---------------------------------------------------------------------------

describe("ApiClient — graph", () => {
  it("getGraph returns {nodes, edges} arrays", async () => {
    const graph = await client.getGraph("ws-1");
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    for (const n of graph.nodes) {
      expect(n).toHaveProperty("path");
      expect(n).toHaveProperty("nodeState");
    }
    for (const e of graph.edges) {
      expect(e).toHaveProperty("from");
      expect(e).toHaveProperty("to");
    }
  });
});

// ---------------------------------------------------------------------------
// Error handling — connection failures & HTTP errors
// ---------------------------------------------------------------------------

describe("ApiClient — errors", () => {
  it("throws ConnectionError with baseUrl when server is unreachable", async () => {
    const bad = createApiClient("http://localhost:19999");
    const err = await bad.listWorkspaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as ConnectionError).baseUrl).toBe("http://localhost:19999");
    expect((err as ConnectionError).message).toContain("cobook server");
  });

  it("throws ApiError with HTTP status for non-2xx responses", async () => {
    const err = await client.getWorkspace("nonexistent").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).name).toBe("ApiError");
  });
});

// ---------------------------------------------------------------------------
// Workspace discovery — pure logic, no network
// ---------------------------------------------------------------------------

describe("findWorkspaceRoot", () => {
  it("returns undefined at filesystem root", () => {
    expect(findWorkspaceRoot("/")).toBeUndefined();
  });
});
