import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "../src/db/client.js";
import { createWorkspaceRepository } from "../src/db/repositories/workspace-repository.js";
import { createCodocRepository } from "../src/db/repositories/codoc-repository.js";
import { createEdgeRepository } from "../src/db/repositories/edge-repository.js";
import { createChatRepository } from "../src/db/repositories/chat-repository.js";
import { createAgentSessionRepository } from "../src/db/repositories/agent-session-repository.js";
import {
  workspaces,
  codocs,
  edges,
  chatThreads,
  chatMessages,
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
    await db.delete(edges);
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
      const c1 = await repo.upsert(ws.id, "notes/a.codoc", {
        content: "v1",
        ast: { meta: {} },
        nodeState: "idle",
      });
      expect(c1.content).toBe("v1");
      expect(c1.path).toBe("notes/a.codoc");

      // Update (same workspace + path → upsert)
      const c2 = await repo.upsert(ws.id, "notes/a.codoc", {
        content: "v2",
        resolvedValue: { x: 1 },
        nodeState: "ready",
      });
      expect(c2.id).toBe(c1.id);
      expect(c2.content).toBe("v2");
      expect(c2.nodeState).toBe("ready");
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
