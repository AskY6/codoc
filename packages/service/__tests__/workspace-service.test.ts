import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "../src/db/client.js";
import { createWorkspaceRepository } from "../src/db/repositories/workspace-repository.js";
import { createCodocRepository } from "../src/db/repositories/codoc-repository.js";
import { createEdgeRepository } from "../src/db/repositories/edge-repository.js";
import {
  workspaces,
  codocs,
  edges,
  chatThreads,
  chatMessages,
  agentSessions,
} from "../src/db/schema.js";
import { createWorkspaceService, type WorkspaceService } from "../src/workspace-service.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("WorkspaceService (PostgreSQL)", () => {
  let db: Database;
  let service: WorkspaceService;

  beforeAll(() => {
    db = createDb(DATABASE_URL!);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  beforeEach(async () => {
    // Clean tables
    await db.delete(agentSessions);
    await db.delete(chatMessages);
    await db.delete(chatThreads);
    await db.delete(edges);
    await db.delete(codocs);
    await db.delete(workspaces);

    service = createWorkspaceService({
      workspaceRepo: createWorkspaceRepository(db),
      codocRepo: createCodocRepository(db),
      edgeRepo: createEdgeRepository(db),
    });
  });

  // -----------------------------------------------------------------------
  // createWorkspace + getStatus
  // -----------------------------------------------------------------------

  describe("createWorkspace", () => {
    it("creates workspace with given name", async () => {
      const ws = await service.createWorkspace("test-project");
      expect(ws.name).toBe("test-project");
      expect(ws.id).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  describe("getStatus", () => {
    it("returns state distribution", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "a.codoc", "data:\n  x: 1\n");
      await service.createCodoc(ws.id, "b.codoc", "data:\n  y: 2\n");

      const status = await service.getStatus(ws.id);
      expect(status.codocCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // build
  // -----------------------------------------------------------------------

  describe("build", () => {
    it("builds DAG from codocs with refs", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "c.codoc", "data:\n  val: 100\n");
      await service.createCodoc(
        ws.id,
        "b.codoc",
        'data:\n  val:\n    $ref: "./c.codoc#data.val"\n',
      );
      await service.createCodoc(
        ws.id,
        "a.codoc",
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );

      const diag = await service.build(ws.id);

      expect(diag.ok).toBe(true);
      expect(diag.codocCount).toBe(3);
      expect(diag.edgeCount).toBe(2);
      expect(diag.errors).toHaveLength(0);
    });

    it("reports cycle errors", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );
      await service.createCodoc(
        ws.id,
        "b.codoc",
        'data:\n  val:\n    $ref: "./a.codoc#data.val"\n',
      );

      const diag = await service.build(ws.id);

      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "cycle")).toBe(true);
    });

    it("reports broken ref errors", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        'data:\n  val:\n    $ref: "./missing.codoc#data.x"\n',
      );

      const diag = await service.build(ws.id);

      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "broken-ref")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // resolve
  // -----------------------------------------------------------------------

  describe("resolve", () => {
    it("resolves a static source node", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "a.codoc", "data:\n  x: 42\n");
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.x");
      expect(value).toBe(42);
    });

    it("resolves a ref node (A refs B)", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "b.codoc", "data:\n  val: hello\n");
      await service.createCodoc(
        ws.id,
        "a.codoc",
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.val");
      expect(value).toBe("hello");
    });

    it("resolves a chain A→B→C", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "c.codoc", "data:\n  val: 99\n");
      await service.createCodoc(
        ws.id,
        "b.codoc",
        'data:\n  val:\n    $ref: "./c.codoc#data.val"\n',
      );
      await service.createCodoc(
        ws.id,
        "a.codoc",
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.val");
      expect(value).toBe(99);
    });
  });

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  describe("CRUD", () => {
    it("createCodoc persists to DB and triggers build", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "new.codoc", "data:\n  x: 1\n");

      const info = await service.getCodoc(ws.id, "new.codoc");
      expect(info).toBeDefined();
      expect(info!.ast).toBeDefined();
    });

    it("updateCodoc updates DB and rebuilds", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "a.codoc", "data:\n  x: 1\n");
      await service.updateCodoc(ws.id, "a.codoc", "data:\n  x: 999\n");

      const info = await service.getCodoc(ws.id, "a.codoc");
      expect(info?.ast).toBeDefined();
    });

    it("deleteCodoc removes from DB and detects broken refs", async () => {
      const ws = await service.createWorkspace("ws");

      await service.createCodoc(ws.id, "b.codoc", "data:\n  val: 1\n");
      await service.createCodoc(
        ws.id,
        "a.codoc",
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );
      await service.build(ws.id);

      await service.deleteCodoc(ws.id, "b.codoc");

      const info = await service.getCodoc(ws.id, "b.codoc");
      expect(info).toBeUndefined();

      const diag = await service.build(ws.id);
      expect(diag.errors.some((e) => e.kind === "broken-ref")).toBe(true);
    });

    it("getCodoc returns undefined for non-existent path", async () => {
      const ws = await service.createWorkspace("ws");

      const info = await service.getCodoc(ws.id, "nope.codoc");
      expect(info).toBeUndefined();
    });
  });
});
