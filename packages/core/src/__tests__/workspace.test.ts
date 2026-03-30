import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../workspace.js";
import type { WorkspaceChangeEvent } from "../workspace.js";
import { setDocRegistry, getDocRegistry } from "../doc-registry.js";

/**
 * Helper: write a .codoc YAML file into the workspace directory.
 */
function codocYaml(opts: {
  type: Record<string, unknown>;
  data: Record<string, unknown>;
  view?: string;
}): string {
  const lines: string[] = [];

  lines.push("type:");
  lines.push(yamlObj(opts.type, 1));
  lines.push("data:");
  lines.push(yamlObj(opts.data, 1));
  lines.push(`view: "${opts.view ?? "# placeholder"}"`);

  return lines.join("\n");
}

function yamlObj(obj: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return `${pad}null`;
  if (typeof obj === "string") return `${pad}"${obj}"`;
  if (typeof obj === "number" || typeof obj === "boolean") return `${pad}${obj}`;
  if (typeof obj !== "object") return `${pad}${String(obj)}`;

  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      lines.push(`${pad}${key}:`);
      lines.push(yamlObj(val, indent + 1));
    } else if (typeof val === "string") {
      lines.push(`${pad}${key}: "${val}"`);
    } else if (typeof val === "number" || typeof val === "boolean") {
      lines.push(`${pad}${key}: ${val}`);
    } else {
      lines.push(`${pad}${key}: ${JSON.stringify(val)}`);
    }
  }
  return lines.join("\n");
}

describe("M5-core: Workspace", () => {
  let wsDir: string;
  let savedRegistry: ReturnType<typeof getDocRegistry>;

  beforeAll(async () => {
    savedRegistry = getDocRegistry();
    wsDir = await mkdtemp(join(tmpdir(), "codoc-ws-"));

    // --- 5+ codoc files with various loader types ---

    // 1. team.codoc — literal fields
    await writeFile(
      join(wsDir, "team.codoc"),
      codocYaml({
        type: {
          properties: {
            name: { type: "string" },
            size: { type: "number" },
          },
        },
        data: { name: "Core Team", size: 5 },
      }),
    );

    // 2. project.codoc — literal + intra-doc $ref
    await writeFile(
      join(wsDir, "project.codoc"),
      codocYaml({
        type: {
          properties: {
            title: { type: "string" },
            slug: { type: "string" },
          },
        },
        data: {
          title: "Codoc",
          slug: { $ref: "/title" },
        },
      }),
    );

    // 3. metrics.codoc — literal values
    await writeFile(
      join(wsDir, "metrics.codoc"),
      codocYaml({
        type: {
          properties: {
            users: { type: "number" },
            revenue: { type: "number" },
          },
        },
        data: { users: 1000, revenue: 50000 },
      }),
    );

    // 4. dashboard.codoc — external refs to metrics.codoc
    await writeFile(
      join(wsDir, "dashboard.codoc"),
      codocYaml({
        type: {
          properties: {
            totalUsers: { type: "number" },
            totalRevenue: { type: "number" },
            label: { type: "string" },
          },
        },
        data: {
          totalUsers: { $ref: "[[metrics.codoc]]/users" },
          totalRevenue: { $ref: "[[metrics.codoc]]/revenue" },
          label: "Dashboard",
        },
      }),
    );

    // 5. report.codoc — chains: refs dashboard + team
    await writeFile(
      join(wsDir, "report.codoc"),
      codocYaml({
        type: {
          properties: {
            teamName: { type: "string" },
            userCount: { type: "number" },
          },
        },
        data: {
          teamName: { $ref: "[[team.codoc]]/name" },
          userCount: { $ref: "[[dashboard.codoc]]/totalUsers" },
        },
      }),
    );

    // 6. invalid.codoc — malformed file (should be skipped)
    await writeFile(join(wsDir, "invalid.codoc"), "not: valid: yaml: [[[");

    // 7. readme.txt — non-codoc file (should be ignored)
    await writeFile(join(wsDir, "readme.txt"), "This is not a codoc");
  });

  afterAll(async () => {
    await rm(wsDir, { recursive: true, force: true });
    if (savedRegistry) {
      setDocRegistry(savedRegistry);
    }
  });

  describe("a. Workspace Index", () => {
    it("lists all valid .codoc files, skipping invalid ones", async () => {
      const ws = await Workspace.create(wsDir);
      const docs = ws.listDocs();
      const ids = docs.map((d) => d.docId).sort();

      expect(ids).toEqual([
        "dashboard.codoc",
        "metrics.codoc",
        "project.codoc",
        "report.codoc",
        "team.codoc",
      ]);
    });

    it("getDocMeta returns type schema and field info", async () => {
      const ws = await Workspace.create(wsDir);
      const meta = ws.getDocMeta("team.codoc");

      expect(meta).toBeDefined();
      expect(meta!.type).toHaveProperty("properties");
      expect(meta!.fields).toHaveLength(2);
      expect(meta!.fields.map((f) => f.path).sort()).toEqual(["/name", "/size"]);
      expect(meta!.fields.find((f) => f.path === "/name")!.loaderType).toBe("literal");
    });

    it("getDocMeta extracts external ref declarations", async () => {
      const ws = await Workspace.create(wsDir);
      const meta = ws.getDocMeta("dashboard.codoc");

      expect(meta!.externalRefs).toHaveLength(2);
      expect(meta!.externalRefs).toContainEqual({
        localPath: "/totalUsers",
        docRef: "metrics.codoc",
        fieldPath: "/users",
      });
      expect(meta!.externalRefs).toContainEqual({
        localPath: "/totalRevenue",
        docRef: "metrics.codoc",
        fieldPath: "/revenue",
      });
    });

    it("getDocMeta returns undefined for unknown docId", async () => {
      const ws = await Workspace.create(wsDir);
      expect(ws.getDocMeta("nonexistent.codoc")).toBeUndefined();
    });

    it("field meta includes schema info from type", async () => {
      const ws = await Workspace.create(wsDir);
      const meta = ws.getDocMeta("metrics.codoc")!;
      const usersField = meta.fields.find((f) => f.path === "/users")!;

      expect(usersField.schema).toEqual({ type: "number" });
    });

    it("detects intra-doc $ref as ref loader type", async () => {
      const ws = await Workspace.create(wsDir);
      const meta = ws.getDocMeta("project.codoc")!;
      const slugField = meta.fields.find((f) => f.path === "/slug")!;

      expect(slugField.loaderType).toBe("ref");
    });

    it("detects external $ref as external loader type", async () => {
      const ws = await Workspace.create(wsDir);
      const meta = ws.getDocMeta("dashboard.codoc")!;
      const totalUsersField = meta.fields.find((f) => f.path === "/totalUsers")!;

      expect(totalUsersField.loaderType).toBe("external");
    });
  });

  describe("b. Global Dependency Graph", () => {
    it("contains nodes for all fields across all docs", async () => {
      const ws = await Workspace.create(wsDir);
      const { nodes } = ws.getDependencyGraph();

      // team: /name, /size
      // project: /title, /slug
      // metrics: /users, /revenue
      // dashboard: /totalUsers, /totalRevenue, /label
      // report: /teamName, /userCount
      expect(nodes.length).toBeGreaterThanOrEqual(11);

      const teamNodes = nodes.filter((n) => n.docId === "team.codoc");
      expect(teamNodes.map((n) => n.fieldPath).sort()).toEqual(["/name", "/size"]);
    });

    it("has cross-doc edges from external refs", async () => {
      const ws = await Workspace.create(wsDir);
      const { edges } = ws.getDependencyGraph();

      // dashboard.codoc /totalUsers → metrics.codoc /users
      expect(edges).toContainEqual({
        from: { docId: "dashboard.codoc", fieldPath: "/totalUsers" },
        to: { docId: "metrics.codoc", fieldPath: "/users" },
      });

      // report.codoc /teamName → team.codoc /name
      expect(edges).toContainEqual({
        from: { docId: "report.codoc", fieldPath: "/teamName" },
        to: { docId: "team.codoc", fieldPath: "/name" },
      });
    });

    it("has intra-doc edges from $ref", async () => {
      const ws = await Workspace.create(wsDir);
      const { edges } = ws.getDependencyGraph();

      // project.codoc /slug → project.codoc /title
      expect(edges).toContainEqual({
        from: { docId: "project.codoc", fieldPath: "/slug" },
        to: { docId: "project.codoc", fieldPath: "/title" },
      });
    });
  });

  describe("c. Document Loading + Cross-doc Resolution", () => {
    it("loadDoc returns tree and dag for a literal doc", async () => {
      const ws = await Workspace.create(wsDir);
      const { tree, dag } = ws.loadDoc("team.codoc");

      expect(tree.getAllPaths().sort()).toEqual(["/name", "/size"]);
      expect(dag.getNodes().length).toBeGreaterThanOrEqual(2);

      const name = await tree.observe("/name");
      expect(name).toBe("Core Team");

      const size = await tree.observe("/size");
      expect(size).toBe(5);
    });

    it("loadDoc resolves intra-doc $ref", async () => {
      const ws = await Workspace.create(wsDir);
      const { tree } = ws.loadDoc("project.codoc");

      const title = await tree.observe("/title");
      expect(title).toBe("Codoc");

      const slug = await tree.observe("/slug");
      expect(slug).toBe("Codoc");
    });

    it("loadDoc resolves cross-doc external refs", async () => {
      const ws = await Workspace.create(wsDir);

      // Load metrics first (target)
      ws.loadDoc("metrics.codoc");

      // Load dashboard (consumer)
      const { tree } = ws.loadDoc("dashboard.codoc");

      const totalUsers = await tree.observe("/totalUsers");
      expect(totalUsers).toBe(1000);

      const totalRevenue = await tree.observe("/totalRevenue");
      expect(totalRevenue).toBe(50000);
    });

    it("loadDoc is idempotent — returns same runtime on second call", async () => {
      const ws = await Workspace.create(wsDir);
      const r1 = ws.loadDoc("team.codoc");
      const r2 = ws.loadDoc("team.codoc");
      expect(r1.tree).toBe(r2.tree);
      expect(r1.dag).toBe(r2.dag);
    });

    it("loadDoc throws for unknown docId", async () => {
      const ws = await Workspace.create(wsDir);
      expect(() => ws.loadDoc("missing.codoc")).toThrow("Document not found");
    });

    it("loadDoc auto-loads dependency docs for external refs", async () => {
      const ws = await Workspace.create(wsDir);

      // Load only the consumer — dependency (metrics.codoc) should auto-load
      const { tree } = ws.loadDoc("dashboard.codoc");

      const totalUsers = await tree.observe("/totalUsers");
      expect(totalUsers).toBe(1000);

      const totalRevenue = await tree.observe("/totalRevenue");
      expect(totalRevenue).toBe(50000);
    });

    it("chain: report → dashboard → metrics resolves end-to-end", async () => {
      const ws = await Workspace.create(wsDir);

      ws.loadDoc("team.codoc");
      ws.loadDoc("metrics.codoc");
      ws.loadDoc("dashboard.codoc");
      const { tree } = ws.loadDoc("report.codoc");

      const teamName = await tree.observe("/teamName");
      expect(teamName).toBe("Core Team");

      // report → dashboard → metrics
      const userCount = await tree.observe("/userCount");
      expect(userCount).toBe(1000);
    });

    it("chain auto-loads: report → dashboard → metrics without manual pre-loading", async () => {
      const ws = await Workspace.create(wsDir);

      // Load only report — should recursively load team, dashboard, metrics
      const { tree } = ws.loadDoc("report.codoc");

      const teamName = await tree.observe("/teamName");
      expect(teamName).toBe("Core Team");

      const userCount = await tree.observe("/userCount");
      expect(userCount).toBe(1000);
    });
  });

  describe("d. Cross-doc Dirty Propagation", () => {
    it("updating upstream field marks downstream as dirty", async () => {
      const ws = await Workspace.create(wsDir);

      const metrics = ws.loadDoc("metrics.codoc");
      const dashboard = ws.loadDoc("dashboard.codoc");

      // Initial force
      await dashboard.tree.observe("/totalUsers");
      expect(dashboard.tree.getField("/totalUsers")!.state.status).toBe("resolved");

      // Update upstream
      metrics.tree.updateField("/users", 2000);

      // Wait for async cross-doc propagation
      await new Promise((r) => setTimeout(r, 100));

      // Dashboard's field should have been re-evaluated
      const updated = await dashboard.tree.observe("/totalUsers");
      expect(updated).toBe(2000);
    });

    it("chain propagation: metrics → dashboard → report", async () => {
      const ws = await Workspace.create(wsDir);

      ws.loadDoc("team.codoc");
      const metrics = ws.loadDoc("metrics.codoc");
      ws.loadDoc("dashboard.codoc");
      const report = ws.loadDoc("report.codoc");

      // Initial force
      await report.tree.observe("/userCount");
      expect(report.tree.getField("/userCount")!.state.status).toBe("resolved");

      // Update origin
      metrics.tree.updateField("/users", 3000);

      // Wait for propagation through chain
      await new Promise((r) => setTimeout(r, 200));

      const updated = await report.tree.observe("/userCount");
      expect(updated).toBe(3000);
    });
  });

  describe("e. createDoc", () => {
    it("creates a new document and indexes it", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-create-"));
      try {
        const ws = await Workspace.create(dir);
        expect(ws.listDocs()).toHaveLength(0);

        const yaml = codocYaml({
          type: { properties: { title: { type: "string" } } },
          data: { title: "Hello" },
        });
        const meta = await ws.createDoc("new.codoc", yaml);

        expect(meta.docId).toBe("new.codoc");
        expect(meta.fields).toHaveLength(1);
        expect(meta.fields[0].path).toBe("/title");
        expect(ws.listDocs()).toHaveLength(1);

        // File written to disk
        const onDisk = await readFile(join(dir, "new.codoc"), "utf-8");
        expect(onDisk).toBe(yaml);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("throws if docId already exists", async () => {
      const ws = await Workspace.create(wsDir);
      const yaml = codocYaml({
        type: { properties: { x: { type: "string" } } },
        data: { x: "val" },
      });
      await expect(ws.createDoc("team.codoc", yaml)).rejects.toThrow(
        "already exists",
      );
    });

    it("throws if docId does not end with .codoc", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-create-"));
      try {
        const ws = await Workspace.create(dir);
        await expect(ws.createDoc("bad.txt", "")).rejects.toThrow(
          "must end with .codoc",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("throws if docId contains path separators", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-create-"));
      try {
        const ws = await Workspace.create(dir);
        await expect(ws.createDoc("sub/doc.codoc", "")).rejects.toThrow(
          "path separators",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("throws on invalid YAML content", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-create-"));
      try {
        const ws = await Workspace.create(dir);
        await expect(
          ws.createDoc("bad.codoc", "not: valid: yaml: [[["),
        ).rejects.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("loadDoc works on newly created doc", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-create-"));
      try {
        const ws = await Workspace.create(dir);
        const yaml = codocYaml({
          type: { properties: { name: { type: "string" } } },
          data: { name: "test" },
        });
        await ws.createDoc("fresh.codoc", yaml);
        const { tree } = ws.loadDoc("fresh.codoc");
        const val = await tree.observe("/name");
        expect(val).toBe("test");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("f. rewriteDoc", () => {
    it("rewrites an existing document and re-indexes", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-rewrite-"));
      try {
        await writeFile(
          join(dir, "doc.codoc"),
          codocYaml({
            type: { properties: { name: { type: "string" } } },
            data: { name: "old" },
          }),
        );
        const ws = await Workspace.create(dir);
        expect(ws.getDocMeta("doc.codoc")!.fields).toHaveLength(1);

        const newYaml = codocYaml({
          type: {
            properties: {
              name: { type: "string" },
              age: { type: "number" },
            },
          },
          data: { name: "new", age: 10 },
        });
        const meta = await ws.rewriteDoc("doc.codoc", newYaml);

        expect(meta.fields).toHaveLength(2);
        expect(meta.fields.map((f) => f.path).sort()).toEqual(["/age", "/name"]);

        // File on disk is updated
        const onDisk = await readFile(join(dir, "doc.codoc"), "utf-8");
        expect(onDisk).toBe(newYaml);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("throws if docId does not exist", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-rewrite-"));
      try {
        const ws = await Workspace.create(dir);
        await expect(
          ws.rewriteDoc("nope.codoc", "anything"),
        ).rejects.toThrow("not found");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("unloads runtime when rewriting a loaded doc", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-rewrite-"));
      try {
        await writeFile(
          join(dir, "doc.codoc"),
          codocYaml({
            type: { properties: { v: { type: "number" } } },
            data: { v: 1 },
          }),
        );
        const ws = await Workspace.create(dir);
        const { tree: oldTree } = ws.loadDoc("doc.codoc");
        const oldVal = await oldTree.observe("/v");
        expect(oldVal).toBe(1);

        // Rewrite with new schema
        await ws.rewriteDoc(
          "doc.codoc",
          codocYaml({
            type: { properties: { v: { type: "number" } } },
            data: { v: 99 },
          }),
        );

        // loadDoc should return a fresh runtime
        const { tree: newTree } = ws.loadDoc("doc.codoc");
        expect(newTree).not.toBe(oldTree);
        const newVal = await newTree.observe("/v");
        expect(newVal).toBe(99);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("throws on invalid YAML content without writing to disk", async () => {
      const dir = await mkdtemp(join(tmpdir(), "codoc-rewrite-"));
      try {
        const originalYaml = codocYaml({
          type: { properties: { x: { type: "string" } } },
          data: { x: "keep" },
        });
        await writeFile(join(dir, "doc.codoc"), originalYaml);
        const ws = await Workspace.create(dir);

        await expect(
          ws.rewriteDoc("doc.codoc", "not: valid: yaml: [[["),
        ).rejects.toThrow();

        // Original file should be unchanged
        const onDisk = await readFile(join(dir, "doc.codoc"), "utf-8");
        expect(onDisk).toBe(originalYaml);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("g. Workspace Change Subscription", () => {
    it("onFieldChange fires when a loaded doc's field resolves", async () => {
      const ws = await Workspace.create(wsDir);
      const events: WorkspaceChangeEvent[] = [];
      ws.onFieldChange((e) => events.push(e));

      const { tree } = ws.loadDoc("team.codoc");
      await tree.observe("/name");

      // Should have at least one event for /name resolving
      const nameEvents = events.filter(
        (e) => e.docId === "team.codoc" && e.fieldPath === "/name",
      );
      expect(nameEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("onFieldChange fires when a field is updated", async () => {
      const ws = await Workspace.create(wsDir);
      const events: WorkspaceChangeEvent[] = [];
      ws.onFieldChange((e) => events.push(e));

      const { tree } = ws.loadDoc("team.codoc");
      await tree.observe("/name");

      events.length = 0;
      tree.updateField("/name", "New Name");

      const nameEvents = events.filter(
        (e) => e.docId === "team.codoc" && e.fieldPath === "/name",
      );
      expect(nameEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("unsubscribe stops notifications", async () => {
      const ws = await Workspace.create(wsDir);
      const events: WorkspaceChangeEvent[] = [];
      const unsub = ws.onFieldChange((e) => events.push(e));

      const { tree } = ws.loadDoc("team.codoc");
      unsub();

      await tree.observe("/name");
      expect(events).toHaveLength(0);
    });

    it("events include timestamp", async () => {
      const ws = await Workspace.create(wsDir);
      const events: WorkspaceChangeEvent[] = [];
      ws.onFieldChange((e) => events.push(e));

      const before = Date.now();
      const { tree } = ws.loadDoc("team.codoc");
      await tree.observe("/name");
      const after = Date.now();

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0].timestamp).toBeLessThanOrEqual(after);
    });
  });
});
