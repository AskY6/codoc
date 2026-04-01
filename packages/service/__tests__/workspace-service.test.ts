import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
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

    // Create temp workspace dir
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
    it("scans codoc files and registers workspace", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: test-project\n");
      await writeFile(
        join(tmpDir, "a.codoc"),
        "meta:\n  title: A\ndata:\n  x: 1\n",
      );
      await mkdir(join(tmpDir, "notes"));
      await writeFile(
        join(tmpDir, "notes", "b.codoc"),
        "meta:\n  title: B\ndata:\n  y: hello\n",
      );

      const ws = await service.openWorkspace(tmpDir);

      expect(ws.name).toBe("test-project");
      expect(ws.rootPath).toBe(tmpDir);

      const status = await service.getStatus(ws.id);
      expect(status.codocCount).toBe(2);
    });

    it("uses default name when cobook.yaml is missing", async () => {
      await writeFile(join(tmpDir, "a.codoc"), "data:\n  x: 1\n");

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
      await writeFile(join(tmpDir, "a.codoc"), "data:\n  x: 1\n");
      await writeFile(join(tmpDir, "b.codoc"), "data:\n  y: 2\n");

      const ws = await service.openWorkspace(tmpDir);
      const status = await service.getStatus(ws.id);

      expect(status.codocCount).toBe(2);
      expect(status.states["idle"]).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 3-2 build
  // -----------------------------------------------------------------------

  describe("build", () => {
    it("builds DAG from codocs with refs", async () => {
      // C has static data, B refs C, A refs B
      await writeFile(
        join(tmpDir, "c.codoc"),
        'data:\n  val: 100\n',
      );
      await writeFile(
        join(tmpDir, "b.codoc"),
        'data:\n  val:\n    $ref: "./c.codoc#data.val"\n',
      );
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );

      const ws = await service.openWorkspace(tmpDir);
      const diag = await service.build(ws.id);

      expect(diag.ok).toBe(true);
      expect(diag.codocCount).toBe(3);
      expect(diag.edgeCount).toBe(2);
      expect(diag.errors).toHaveLength(0);
    });

    it("reports cycle errors", async () => {
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );
      await writeFile(
        join(tmpDir, "b.codoc"),
        'data:\n  val:\n    $ref: "./a.codoc#data.val"\n',
      );

      const ws = await service.openWorkspace(tmpDir);
      const diag = await service.build(ws.id);

      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "cycle")).toBe(true);
    });

    it("reports broken ref errors", async () => {
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  val:\n    $ref: "./missing.codoc#data.x"\n',
      );

      const ws = await service.openWorkspace(tmpDir);
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
      await writeFile(join(tmpDir, "a.codoc"), "data:\n  x: 42\n");

      const ws = await service.openWorkspace(tmpDir);
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.x");
      expect(value).toBe(42);
    });

    it("resolves a file source node", async () => {
      await writeFile(join(tmpDir, "data.json"), JSON.stringify({ count: 7 }));
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  info:\n    $source: file\n    path: "./data.json"\n',
      );

      const ws = await service.openWorkspace(tmpDir);
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.info");
      expect(value).toEqual({ count: 7 });
    });

    it("resolves a ref node (A refs B)", async () => {
      await writeFile(join(tmpDir, "b.codoc"), "data:\n  val: hello\n");
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );

      const ws = await service.openWorkspace(tmpDir);
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.val");
      expect(value).toBe("hello");
    });

    it("resolves a chain A→B→C", async () => {
      await writeFile(join(tmpDir, "c.codoc"), "data:\n  val: 99\n");
      await writeFile(
        join(tmpDir, "b.codoc"),
        'data:\n  val:\n    $ref: "./c.codoc#data.val"\n',
      );
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );

      const ws = await service.openWorkspace(tmpDir);
      await service.build(ws.id);

      const value = await service.resolve(ws.id, "a.codoc#data.val");
      expect(value).toBe(99);
    });
  });

  // -----------------------------------------------------------------------
  // 3-5 CRUD
  // -----------------------------------------------------------------------

  describe("CRUD", () => {
    it("createCodoc writes file and triggers build", async () => {
      await writeFile(join(tmpDir, "cobook.yaml"), "name: ws\n");
      const ws = await service.openWorkspace(tmpDir);

      await service.createCodoc(ws.id, "new.codoc", "data:\n  x: 1\n");

      // File exists on disk
      const content = await readFile(join(tmpDir, "new.codoc"), "utf-8");
      expect(content).toContain("x: 1");

      // Queryable via getCodoc
      const info = await service.getCodoc(ws.id, "new.codoc");
      expect(info).toBeDefined();
      expect(info!.ast).toBeDefined();
    });

    it("updateCodoc rewrites file and rebuilds", async () => {
      await writeFile(join(tmpDir, "a.codoc"), "data:\n  x: 1\n");
      const ws = await service.openWorkspace(tmpDir);

      await service.updateCodoc(ws.id, "a.codoc", "data:\n  x: 999\n");

      const content = await readFile(join(tmpDir, "a.codoc"), "utf-8");
      expect(content).toContain("x: 999");

      const info = await service.getCodoc(ws.id, "a.codoc");
      expect(info?.ast).toBeDefined();
    });

    it("deleteCodoc removes file and detects broken refs", async () => {
      await writeFile(join(tmpDir, "b.codoc"), "data:\n  val: 1\n");
      await writeFile(
        join(tmpDir, "a.codoc"),
        'data:\n  val:\n    $ref: "./b.codoc#data.val"\n',
      );
      const ws = await service.openWorkspace(tmpDir);
      await service.build(ws.id);

      await service.deleteCodoc(ws.id, "b.codoc");

      // b.codoc should be gone
      const info = await service.getCodoc(ws.id, "b.codoc");
      expect(info).toBeUndefined();

      // Rebuild should detect broken ref from a → b
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
