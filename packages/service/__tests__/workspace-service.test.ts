import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  let tmpDir: string;

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

    // Create temp workspace dir (for cobook.yaml only)
    tmpDir = await mkdtemp(join(tmpdir(), "codoc-ws-"));

    service = createWorkspaceService({
      workspaceRepo: createWorkspaceRepository(db),
      codocRepo: createCodocRepository(db),
      edgeRepo: createEdgeRepository(db),
    });
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  // -----------------------------------------------------------------------
  // 3-1 openWorkspace + getStatus
  // -----------------------------------------------------------------------

  describe("openWorkspace", () => {
    it("reads cobook.yaml and registers workspace", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: test-project\n");

      const ws = await service.openWorkspace(tmpDir);

      expect(ws.name).toBe("test-project");
      expect(ws.rootPath).toBe(tmpDir);
    });

    it("uses default name when cobook.yaml is missing", async () => {
      const ws = await service.openWorkspace(tmpDir);
      expect(ws.name).toBe("untitled");
    });

    it("returns existing workspace on re-open", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");

      const ws1 = await service.openWorkspace(tmpDir);
      const ws2 = await service.openWorkspace(tmpDir);
      expect(ws1.id).toBe(ws2.id);
    });
  });

  // -----------------------------------------------------------------------
  // 3-1 getStatus
  // -----------------------------------------------------------------------

  describe("getStatus", () => {
    it("returns state distribution", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

      await service.createCodoc(ws.id, "a.codoc", "data:\n  x: 1\n");
      await service.createCodoc(ws.id, "b.codoc", "data:\n  y: 2\n");

      const status = await service.getStatus(ws.id);
      expect(status.codocCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 3-2 build
  // -----------------------------------------------------------------------

  describe("build", () => {
    it("builds DAG from codocs with refs", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

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
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

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
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

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
  // 3-3 resolve
  // -----------------------------------------------------------------------

  describe("resolve", () => {
    it("resolves a static source node", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

      await service.createCodoc(ws.id, "a.codoc", "data:\n  x: 42\n");
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.x");
      expect(value).toBe(42);
    });

    it("resolves a ref node (A refs B)", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

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
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

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
  // 3-5 CRUD
  // -----------------------------------------------------------------------

  describe("CRUD", () => {
    it("createCodoc persists to DB and triggers build", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

      await service.createCodoc(ws.id, "new.codoc", "data:\n  x: 1\n");

      const info = await service.getCodoc(ws.id, "new.codoc");
      expect(info).toBeDefined();
      expect(info!.ast).toBeDefined();
    });

    it("updateCodoc updates DB and rebuilds", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

      await service.createCodoc(ws.id, "a.codoc", "data:\n  x: 1\n");
      await service.updateCodoc(ws.id, "a.codoc", "data:\n  x: 999\n");

      const info = await service.getCodoc(ws.id, "a.codoc");
      expect(info?.ast).toBeDefined();
    });

    it("deleteCodoc removes from DB and detects broken refs", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

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
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

      const info = await service.getCodoc(ws.id, "nope.codoc");
      expect(info).toBeUndefined();
    });
  });
});
