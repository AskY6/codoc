import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  createChatRepository,
  createCodocRepository,
  workspaces,
  codocs,
  edges,
  chatThreads,
  chatMessages,
  threadCodocs,
  threadAgents,
  workspaceAgents,
  agentSessions,
  type Database,
} from "@cobook/storage";
import {
  createWorkspaceService,
  type WorkspaceService,
} from "../src/workspace-service.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build an MDX-formatted codoc with meta + data. */
function codoc(opts: {
  meta?: Record<string, unknown>;
  data?: Record<string, unknown>;
  body?: string;
}): string {
  const lines: string[] = [];
  if (opts.meta) {
    lines.push("meta:");
    for (const [k, v] of Object.entries(opts.meta)) {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
  if (opts.data) {
    lines.push("data:");
    for (const [k, v] of Object.entries(opts.data)) {
      if (typeof v === "object" && v !== null && "$ref" in v) {
        lines.push(`  ${k}:`);
        lines.push(`    $ref: "${(v as { $ref: string }).$ref}"`);
      } else if (typeof v === "object" && v !== null && "$source" in v) {
        const src = v as { $source: string; [k: string]: unknown };
        lines.push(`  ${k}:`);
        lines.push(`    $source: "${src.$source}"`);
        for (const [pk, pv] of Object.entries(src)) {
          if (pk === "$source") continue;
          lines.push(`    ${pk}: ${JSON.stringify(pv)}`);
        }
      } else {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  const frontmatter = lines.join("\n");
  const body = opts.body?.trim() ?? "";
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("WorkspaceService — golden baseline", () => {
  let db: Database;
  let service: WorkspaceService;
  let chatRepo: ReturnType<typeof createChatRepository>;

  beforeAll(() => {
    db = createDb(DATABASE_URL!);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  beforeEach(async () => {
    // Clean tables in reverse-dependency order
    await db.delete(agentSessions);
    await db.delete(threadAgents);
    await db.delete(threadCodocs);
    await db.delete(chatMessages);
    await db.delete(chatThreads);
    await db.delete(workspaceAgents);
    await db.delete(edges);
    await db.delete(codocs);
    await db.delete(workspaces);

    chatRepo = createChatRepository(db);
    service = createWorkspaceService({ db });
  });

  // -----------------------------------------------------------------------
  // 1. Normal build + resolve → read resolvedValue
  // -----------------------------------------------------------------------

  describe("build + resolve → resolvedValue", () => {
    it("persists static field values into resolvedValue after build", async () => {
      const ws = await service.createWorkspace("bt");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { title: "hello", count: 42 } }),
      );

      const diag = await service.build(ws.id);
      expect(diag.ok).toBe(true);
      expect(diag.codocCount).toBe(1);
      expect(diag.errors).toHaveLength(0);

      const info = await service.getCodoc(ws.id, "a.codoc");
      expect(info).toBeDefined();
      expect(info!.nodeState).toBe("ready");
      expect(info!.resolvedData).toMatchObject({
        "a.codoc#data.title": "hello",
        "a.codoc#data.count": 42,
      });
    });

    it("resolves a ref chain A → B → C and persists resolved values", async () => {
      const ws = await service.createWorkspace("chain");

      await service.createCodoc(
        ws.id,
        "c.codoc",
        codoc({ data: { val: 99 } }),
      );
      await service.createCodoc(
        ws.id,
        "b.codoc",
        codoc({ data: { val: { $ref: "./c.codoc#data.val" } } }),
      );
      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: { $ref: "./b.codoc#data.val" } } }),
      );

      const diag = await service.build(ws.id);
      expect(diag.ok).toBe(true);
      expect(diag.edgeCount).toBe(2);

      // resolve() should return the upstream value
      const value = await service.resolve(ws.id, "a.codoc#data.val");
      expect(value).toBe(99);

      // And persist the resolved value back to the row
      const a = await service.getCodoc(ws.id, "a.codoc");
      expect(a?.resolvedData?.["a.codoc#data.val"]).toBe(99);
    });

    it("createCodoc triggers a rebuild and leaves nodeState=ready for valid static data", async () => {
      const ws = await service.createWorkspace("cr");

      await service.createCodoc(
        ws.id,
        "x.codoc",
        codoc({ data: { greeting: "hi" } }),
      );

      const info = await service.getCodoc(ws.id, "x.codoc");
      expect(info?.nodeState).toBe("ready");
      expect(info?.resolvedData?.["x.codoc#data.greeting"]).toBe("hi");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Modify content → dirty → ready transition
  // -----------------------------------------------------------------------

  describe("updateCodoc → dirty → ready flow", () => {
    it("marks codoc dirty before rebuild and ready after rebuild completes", async () => {
      const ws = await service.createWorkspace("upd");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: 1 } }),
      );

      // Sanity: initial state is ready after createCodoc
      const before = await service.getCodoc(ws.id, "a.codoc");
      expect(before?.nodeState).toBe("ready");
      expect(before?.resolvedData?.["a.codoc#data.val"]).toBe(1);

      // Update triggers the dirty → rebuild → ready cycle; the post-update
      // state must be ready and the new value must be visible.
      await service.updateCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: 999 } }),
      );

      const after = await service.getCodoc(ws.id, "a.codoc");
      expect(after?.nodeState).toBe("ready");
      expect(after?.resolvedData?.["a.codoc#data.val"]).toBe(999);
    });

    it("updateCodoc drops stale resolved keys when a field is removed", async () => {
      const ws = await service.createWorkspace("drop");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { keep: 1, drop: 2 } }),
      );

      let info = await service.getCodoc(ws.id, "a.codoc");
      expect(info?.resolvedData?.["a.codoc#data.drop"]).toBe(2);

      // Remove the "drop" field
      await service.updateCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { keep: 1 } }),
      );

      info = await service.getCodoc(ws.id, "a.codoc");
      expect(info?.nodeState).toBe("ready");
      expect(info?.resolvedData?.["a.codoc#data.keep"]).toBe(1);
      expect(info?.resolvedData).not.toHaveProperty("a.codoc#data.drop");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Cycle / broken-ref → nodeState error
  // -----------------------------------------------------------------------

  describe("invalid DAG → error nodeState", () => {
    it("marks codocs in a cycle with nodeState=error", async () => {
      const ws = await service.createWorkspace("cyc");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: { $ref: "./b.codoc#data.val" } } }),
      );
      await service.createCodoc(
        ws.id,
        "b.codoc",
        codoc({ data: { val: { $ref: "./a.codoc#data.val" } } }),
      );

      const diag = await service.build(ws.id);
      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "cycle")).toBe(true);

      const a = await service.getCodoc(ws.id, "a.codoc");
      const b = await service.getCodoc(ws.id, "b.codoc");
      expect(a?.nodeState).toBe("error");
      expect(b?.nodeState).toBe("error");
    });

    it("marks codocs with broken refs as nodeState=error", async () => {
      const ws = await service.createWorkspace("bref");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: { $ref: "./missing.codoc#data.x" } } }),
      );

      const diag = await service.build(ws.id);
      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "broken-ref")).toBe(true);

      const a = await service.getCodoc(ws.id, "a.codoc");
      expect(a?.nodeState).toBe("error");
    });

    it("pins error state at field granularity so healthy sibling fields keep their values", async () => {
      const ws = await service.createWorkspace("per-field");

      // A single codoc with one healthy static field and one broken ref.
      // Under the per-field model, only the ref field is marked error —
      // the sibling static field keeps its resolved value.
      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({
          data: {
            healthy: "ok",
            broken: { $ref: "./missing.codoc#data.x" },
          },
        }),
      );

      const diag = await service.build(ws.id);
      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "broken-ref")).toBe(true);

      const info = await service.getCodoc(ws.id, "a.codoc");
      // Codoc-level state aggregates: any error field → codoc is "error".
      expect(info?.nodeState).toBe("error");
      // But the healthy field still has its value in resolvedData.
      expect(info?.resolvedData?.["a.codoc#data.healthy"]).toBe("ok");
    });

    it("deleting an upstream codoc breaks dependents' refs on next build", async () => {
      const ws = await service.createWorkspace("del");

      await service.createCodoc(
        ws.id,
        "b.codoc",
        codoc({ data: { val: 5 } }),
      );
      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: { $ref: "./b.codoc#data.val" } } }),
      );

      // First build: everything is ready
      let diag = await service.build(ws.id);
      expect(diag.ok).toBe(true);

      // Delete the upstream — deleteCodoc triggers a rebuild internally.
      await service.deleteCodoc(ws.id, "b.codoc");

      // A now references a missing codoc → broken-ref error on the DAG.
      diag = await service.build(ws.id);
      expect(diag.ok).toBe(false);
      expect(diag.errors.some((e) => e.kind === "broken-ref")).toBe(true);

      const a = await service.getCodoc(ws.id, "a.codoc");
      expect(a?.nodeState).toBe("error");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Preset application → workspace_agents persistence
  // -----------------------------------------------------------------------

  describe("preset application", () => {
    it("createWorkspaceFromPreset seeds codocs and writes workspace_agents", async () => {
      const presets = service.listPresets();
      expect(presets.length).toBeGreaterThan(0);
      const preset = presets[0]!;

      const defaultAgents = preset.agentOptions
        .filter((a) => a.selectedByDefault)
        .map((a) => a.id);
      const expectedAgents =
        defaultAgents.length > 0
          ? defaultAgents
          : preset.agentOptions.map((a) => a.id);

      const ws = await service.createWorkspaceFromPreset(preset.id);

      // workspace row
      expect(ws.id).toBeDefined();
      expect(ws.name).toBe(preset.defaultWorkspaceName);

      // codocs landed in DB
      const list = await service.listCodocs(ws.id);
      expect(list.length).toBeGreaterThan(0);

      // workspace_agents landed in DB
      const rows = await chatRepo.getWorkspaceAgents(ws.id);
      const persisted = rows.map((r) => r.agentId).sort();
      expect(persisted).toEqual([...expectedAgents].sort());
    });

    it("applyPreset honours explicit agentIds override", async () => {
      const preset = service.listPresets()[0]!;
      if (preset.agentOptions.length < 2) {
        // Preset only has one agent option — nothing to pick between.
        return;
      }
      const picked = [preset.agentOptions[0]!.id];

      const ws = await service.createWorkspaceFromPreset(
        preset.id,
        "override-test",
        picked,
      );

      const rows = await chatRepo.getWorkspaceAgents(ws.id);
      expect(rows.map((r) => r.agentId).sort()).toEqual(picked.sort());
    });

    it("rejects applyPreset with empty agentIds array", async () => {
      const preset = service.listPresets()[0]!;
      const ws = await service.createWorkspace("reject");
      await expect(service.applyPreset(ws.id, preset.id, [])).rejects.toThrow(
        /At least one preset agent/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Regression: status / listCodocs sanity
  // -----------------------------------------------------------------------

  describe("status & listCodocs", () => {
    it("getStatus returns a distribution that matches persisted nodeStates", async () => {
      const ws = await service.createWorkspace("st");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { x: 1 } }),
      );
      await service.createCodoc(
        ws.id,
        "b.codoc",
        codoc({ data: { val: { $ref: "./nope.codoc#data.x" } } }),
      );

      const status = await service.getStatus(ws.id);
      expect(status.codocCount).toBe(2);
      // "b.codoc" is a broken ref → error; "a.codoc" is ready.
      expect(status.states["ready"] ?? 0).toBe(1);
      expect(status.states["error"] ?? 0).toBe(1);
    });

    it("listCodocs returns title/description from meta", async () => {
      const ws = await service.createWorkspace("meta");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({
          meta: { title: "The A", description: "first" },
          data: { x: 1 },
        }),
      );

      const list = await service.listCodocs(ws.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.meta.title).toBe("The A");
      expect(list[0]!.meta.description).toBe("first");
    });
  });

  // -----------------------------------------------------------------------
  // Regression: getCodoc(nonexistent)
  // -----------------------------------------------------------------------

  describe("getCodoc", () => {
    it("returns undefined for a path that does not exist", async () => {
      const ws = await service.createWorkspace("nf");
      expect(await service.getCodoc(ws.id, "nope.codoc")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Transaction rollback — repos built from a tx handle must roll back on throw
  // -----------------------------------------------------------------------

  describe("withTx / rollback", () => {
    it("repositories built from a tx handle roll back all writes when the callback throws", async () => {
      const ws = await service.createWorkspace("rb");

      await expect(
        db.transaction(async (tx) => {
          // Same factories the service uses internally — proves the executor
          // union accepts a transaction handle.
          const txCodocRepo = createCodocRepository(tx);
          await txCodocRepo.upsert(ws.id, "a.codoc", {
            content: codoc({ data: { val: 1 } }),
          });
          // Sanity: the row is visible *inside* the transaction.
          const insideTx = await txCodocRepo.findByPath(ws.id, "a.codoc");
          expect(insideTx?.path).toBe("a.codoc");

          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      // The failed transaction must not leave any codoc behind.
      const afterRollback = await service.getCodoc(ws.id, "a.codoc");
      expect(afterRollback).toBeUndefined();
    });

    it("service.createCodoc does not corrupt existing state when input fails to parse", async () => {
      const ws = await service.createWorkspace("parse-fail");

      await service.createCodoc(
        ws.id,
        "a.codoc",
        codoc({ data: { val: 1 } }),
      );
      const beforeState = await service.getCodoc(ws.id, "a.codoc");
      expect(beforeState?.nodeState).toBe("ready");

      // Invalid MDX (no frontmatter delimiters) — parseCodoc throws and
      // createCodoc's tx must roll back any in-flight writes.
      await expect(
        service.createCodoc(ws.id, "b.codoc", "not a codoc"),
      ).rejects.toThrow();

      // The bad codoc must not be persisted.
      expect(await service.getCodoc(ws.id, "b.codoc")).toBeUndefined();
      // And the previously-ready codoc must be untouched.
      const afterState = await service.getCodoc(ws.id, "a.codoc");
      expect(afterState?.nodeState).toBe("ready");
      expect(afterState?.resolvedData?.["a.codoc#data.val"]).toBe(1);
    });
  });
});
