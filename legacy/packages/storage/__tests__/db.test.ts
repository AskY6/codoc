import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "../src/db/client.js";
import { createWorkspaceRepository } from "../src/db/repositories/workspace-repository.js";
import { createCodocRepository } from "../src/db/repositories/codoc-repository.js";
import { createEdgeRepository } from "../src/db/repositories/edge-repository.js";
import { createChatRepository } from "../src/db/repositories/chat-repository.js";
import { createWorkspaceAgentRepository } from "../src/db/repositories/workspace-agent-repository.js";
import { createAgentSessionRepository } from "../src/db/repositories/agent-session-repository.js";
import { createResolvedFieldRepository } from "../src/db/repositories/resolved-field-repository.js";
import {
  workspaces,
  codocs,
  codocResolvedFields,
  edges,
  chatThreads,
  chatMessages,
  workspaceAgents,
  agentSessions,
} from "../src/db/schema.js";

const DATABASE_URL = process.env["DATABASE_URL"];

const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("repositories (PostgreSQL)", () => {
  let db: Database;

  beforeAll(() => {
    db = createDb(DATABASE_URL!);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  beforeEach(async () => {
    // Clean all tables in reverse dependency order
    await db.delete(agentSessions);
    await db.delete(chatMessages);
    await db.delete(chatThreads);
    await db.delete(workspaceAgents);
    await db.delete(edges);
    await db.delete(codocResolvedFields);
    await db.delete(codocs);
    await db.delete(workspaces);
  });

  // -------------------------------------------------------------------------
  // WorkspaceRepository
  // -------------------------------------------------------------------------

  describe("WorkspaceRepository", () => {
    it("creates and retrieves a workspace", async () => {
      const repo = createWorkspaceRepository(db);
      const ws = await repo.create({ name: "test-project" });

      expect(ws.id).toBeDefined();
      expect(ws.name).toBe("test-project");

      const found = await repo.findById(ws.id);
      expect(found?.name).toBe("test-project");
    });

    it("lists all workspaces", async () => {
      const repo = createWorkspaceRepository(db);
      await repo.create({ name: "a" });
      await repo.create({ name: "b" });

      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    it("deletes a workspace", async () => {
      const repo = createWorkspaceRepository(db);
      const ws = await repo.create({ name: "del" });
      await repo.delete(ws.id);

      expect(await repo.findById(ws.id)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // CodocRepository
  // -------------------------------------------------------------------------

  describe("CodocRepository", () => {
    it("upserts a codoc (insert then update)", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createCodocRepository(db);

      // Insert
      const c1 = await repo.upsert(ws.id, "notes/a.codoc", { content: "v1" });
      expect(c1.content).toBe("v1");
      expect(c1.path).toBe("notes/a.codoc");

      // Update (same workspace + path → upsert)
      const c2 = await repo.upsert(ws.id, "notes/a.codoc", { content: "v2" });
      expect(c2.id).toBe(c1.id);
      expect(c2.content).toBe("v2");
    });

    it("lists codocs by workspace", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createCodocRepository(db);

      await repo.upsert(ws.id, "a.codoc", { content: "a" });
      await repo.upsert(ws.id, "b.codoc", { content: "b" });

      const list = await repo.listByWorkspace(ws.id);
      expect(list).toHaveLength(2);
    });

    it("deletes a codoc", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createCodocRepository(db);

      await repo.upsert(ws.id, "del.codoc", { content: "x" });
      await repo.delete(ws.id, "del.codoc");

      expect(await repo.findByPath(ws.id, "del.codoc")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // ResolvedFieldRepository
  // -------------------------------------------------------------------------

  describe("ResolvedFieldRepository", () => {
    it("replaceForCodoc wipes prior rows and inserts the new set", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const codocRepo = createCodocRepository(db);
      const repo = createResolvedFieldRepository(db);

      const ws = await wsRepo.create({ name: "ws" });
      const c = await codocRepo.upsert(ws.id, "a.codoc", { content: "x" });

      await repo.replaceForCodoc(ws.id, c.id, [
        { nodeId: "a.codoc#data.x", value: 1, state: "ready" },
        { nodeId: "a.codoc#data.y", value: 2, state: "ready" },
      ]);
      let rows = await repo.listByCodoc(c.id);
      expect(rows).toHaveLength(2);

      // Second replace drops y and keeps only x with a new value
      await repo.replaceForCodoc(ws.id, c.id, [
        { nodeId: "a.codoc#data.x", value: 99, state: "ready" },
      ]);
      rows = await repo.listByCodoc(c.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.nodeId).toBe("a.codoc#data.x");
      expect(rows[0]!.value).toBe(99);
    });

    it("upsertField updates on (workspace_id, node_id) conflict", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const codocRepo = createCodocRepository(db);
      const repo = createResolvedFieldRepository(db);

      const ws = await wsRepo.create({ name: "ws" });
      const c = await codocRepo.upsert(ws.id, "a.codoc", { content: "x" });

      await repo.upsertField(ws.id, c.id, "a.codoc#data.x", 1, "ready");
      await repo.upsertField(ws.id, c.id, "a.codoc#data.x", 2, "ready");

      const hit = await repo.findByNodeId(ws.id, "a.codoc#data.x");
      expect(hit?.value).toBe(2);

      const all = await repo.listByWorkspace(ws.id);
      expect(all).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // EdgeRepository
  // -------------------------------------------------------------------------

  describe("EdgeRepository", () => {
    it("replaces all edges for a workspace", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createEdgeRepository(db);

      // First batch
      await repo.replaceAll(ws.id, [
        { fromNodeId: "a#data.x", toNodeId: "b#data.y" },
      ]);
      let list = await repo.listByWorkspace(ws.id);
      expect(list).toHaveLength(1);

      // Replace with new batch
      await repo.replaceAll(ws.id, [
        { fromNodeId: "c#data.x", toNodeId: "d#data.y" },
        { fromNodeId: "e#data.x", toNodeId: "f#data.y" },
      ]);
      list = await repo.listByWorkspace(ws.id);
      expect(list).toHaveLength(2);
      expect(list.map((e) => e.fromNodeId).sort()).toEqual(["c#data.x", "e#data.x"]);
    });

    it("handles empty edge list", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createEdgeRepository(db);

      await repo.replaceAll(ws.id, [
        { fromNodeId: "a#data.x", toNodeId: "b#data.y" },
      ]);
      await repo.replaceAll(ws.id, []);

      const list = await repo.listByWorkspace(ws.id);
      expect(list).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // ChatRepository
  // -------------------------------------------------------------------------

  describe("ChatRepository", () => {
    it("creates thread and adds messages", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createChatRepository(db);

      const thread = await repo.createThread(ws.id, "test chat");
      expect(thread.id).toBeDefined();
      expect(thread.title).toBe("test chat");

      await repo.addMessage(thread.id, { role: "user", content: "hello" });
      await repo.addMessage(thread.id, { role: "assistant", content: "hi" });

      const messages = await repo.getMessages(thread.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toBe("user");
      expect(messages[1]!.role).toBe("assistant");
    });

    it("retrieves thread by id", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createChatRepository(db);

      const thread = await repo.createThread(ws.id);
      const found = await repo.getThread(thread.id);
      expect(found?.id).toBe(thread.id);
    });

    it("lists threads by workspace", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createChatRepository(db);

      await repo.createThread(ws.id, "t1");
      await repo.createThread(ws.id, "t2");

      const threads = await repo.listThreads(ws.id);
      expect(threads).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // WorkspaceAgentRepository
  // -------------------------------------------------------------------------

  describe("WorkspaceAgentRepository", () => {
    it("setForWorkspace replaces the workspace agent set", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createWorkspaceAgentRepository(db);

      // Initial set
      await repo.setForWorkspace(ws.id, ["alpha", "beta"]);
      let rows = await repo.listByWorkspace(ws.id);
      expect(rows.map((r) => r.agentId).sort()).toEqual(["alpha", "beta"]);

      // Replace — drops beta, keeps alpha, adds gamma
      await repo.setForWorkspace(ws.id, ["alpha", "gamma"]);
      rows = await repo.listByWorkspace(ws.id);
      expect(rows.map((r) => r.agentId).sort()).toEqual(["alpha", "gamma"]);
    });

    it("setForWorkspace with an empty array clears the set", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createWorkspaceAgentRepository(db);

      await repo.setForWorkspace(ws.id, ["alpha"]);
      await repo.setForWorkspace(ws.id, []);
      const rows = await repo.listByWorkspace(ws.id);
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // AgentSessionRepository
  // -------------------------------------------------------------------------

  describe("AgentSessionRepository", () => {
    it("upserts agent session", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createAgentSessionRepository(db);

      // Insert
      const s1 = await repo.upsert(ws.id, null, {
        activeSceneId: "rss",
        state: { step: "awaiting_url" },
      });
      expect(s1.activeSceneId).toBe("rss");

      // Update
      const s2 = await repo.upsert(ws.id, null, {
        state: { step: "done" },
      });
      expect(s2.id).toBe(s1.id);
      expect((s2.state as Record<string, unknown>)["step"]).toBe("done");
    });

    it("finds by workspace", async () => {
      const wsRepo = createWorkspaceRepository(db);
      const ws = await wsRepo.create({ name: "ws" });
      const repo = createAgentSessionRepository(db);

      expect(await repo.findByWorkspace(ws.id)).toBeUndefined();

      await repo.upsert(ws.id, null, { state: {} });
      const found = await repo.findByWorkspace(ws.id);
      expect(found).toBeDefined();
    });
  });
});
