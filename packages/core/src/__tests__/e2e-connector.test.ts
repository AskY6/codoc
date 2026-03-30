import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../workspace.js";
import { setDocRegistry, getDocRegistry } from "../doc-registry.js";
import { registerConnector, clearConnectorRegistry } from "../connector/registry.js";
import { getCredentialStore } from "../connector/credential-store.js";
import { clearSourceCache } from "../loader/source.js";
import { SourceScheduler } from "../source-scheduler.js";
import { scheduleForce } from "../scheduler.js";
import type { ConnectorMeta } from "../connector/types.js";

/**
 * E2E: Connector integration — full pipeline.
 *
 * Tests the real flow:
 *   1. Register a mock connector
 *   2. Create a codoc with $source: { connector: ... }
 *   3. Load + observe → connector function is called → field resolves
 *   4. TTL refresh → field invalidated → re-observe → connector called again
 *   5. Auth-missing → connector throws → field enters error state
 *   6. DAG propagation: downstream $prompt field depends on connector field
 */

const mockConnectorFn = vi.fn();

const mockMeta: ConnectorMeta = {
  name: "mock-api",
  displayName: "Mock API",
  description: "A test connector for e2e testing",
  configSchema: { type: "object", required: ["endpoint"] },
  authSchema: { type: "object", required: ["token"] },
  exampleYaml: "data:\n  $source:\n    connector: mock-api\n    endpoint: /test",
};

describe("E2E: Connector pipeline", () => {
  let wsDir: string;
  let savedRegistry: ReturnType<typeof getDocRegistry>;

  beforeAll(async () => {
    savedRegistry = getDocRegistry();
    wsDir = await mkdtemp(join(tmpdir(), "codoc-connector-e2e-"));
  });

  afterAll(async () => {
    if (savedRegistry) setDocRegistry(savedRegistry);
    await rm(wsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    clearSourceCache();
    clearConnectorRegistry();
    getCredentialStore().clear();
    mockConnectorFn.mockReset();
  });

  it("full flow: create codoc → connector fetch → field resolved", async () => {
    // 1. Register connector + credentials
    mockConnectorFn.mockResolvedValue([
      { name: "Task A", status: "进行中" },
      { name: "Task B", status: "已完成" },
    ]);
    registerConnector(mockMeta, mockConnectorFn);
    getCredentialStore().set("mock-api", { token: "test-token" });

    // 2. Create workspace + codoc with connector $source
    const ws = await Workspace.create(wsDir);

    const yaml = `type:
  properties:
    tasks:
      type: array
      items:
        type: object
data:
  tasks:
    $source:
      connector: mock-api
      endpoint: /tasks
      filter: active
    ttl: 60
view: "# Tasks"`;

    await ws.createDoc("tasks.codoc", yaml);

    // 3. Load doc and observe
    const { tree, dag } = ws.loadDoc("tasks.codoc");

    const result = await tree.observe("/tasks");

    // 4. Verify connector was called with correct args
    expect(mockConnectorFn).toHaveBeenCalledTimes(1);
    expect(mockConnectorFn).toHaveBeenCalledWith(
      { endpoint: "/tasks", filter: "active" },
      { token: "test-token" },
    );

    // 5. Verify field resolved with connector data
    expect(result).toEqual([
      { name: "Task A", status: "进行中" },
      { name: "Task B", status: "已完成" },
    ]);
    expect(tree.getField("/tasks")!.state).toEqual({
      status: "resolved",
      value: [
        { name: "Task A", status: "进行中" },
        { name: "Task B", status: "已完成" },
      ],
    });
  });

  it("TTL refresh: lazy invalidation → re-observe → fresh data", async () => {
    vi.useFakeTimers();

    mockConnectorFn
      .mockResolvedValueOnce([{ v: 1 }])
      .mockResolvedValueOnce([{ v: 2 }]);
    registerConnector(mockMeta, mockConnectorFn);
    getCredentialStore().set("mock-api", { token: "t" });

    const ws = await Workspace.create(wsDir);

    // Use the already-created tasks.codoc (ttl: 60)
    const { tree, dag } = ws.loadDoc("tasks.codoc");

    await tree.observe("/tasks");
    expect(mockConnectorFn).toHaveBeenCalledTimes(1);
    expect(tree.getField("/tasks")!.state.status).toBe("resolved");

    // Start scheduler
    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();
    expect(scheduler.size).toBe(1);

    // Advance past TTL (60s)
    vi.advanceTimersByTime(60_000);

    // Lazy: field should be dirty, no refetch yet
    expect(tree.getField("/tasks")!.state.status).toBe("dirty");
    expect(mockConnectorFn).toHaveBeenCalledTimes(1);

    // Re-observe → triggers connector refetch
    const fresh = await tree.observe("/tasks");
    expect(mockConnectorFn).toHaveBeenCalledTimes(2);
    expect(fresh).toEqual([{ v: 2 }]);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it("auth missing: connector throws → field enters error state", async () => {
    mockConnectorFn.mockRejectedValue({
      kind: "source",
      message: "飞书认证未配置：缺少 appId 或 appSecret",
      retryable: false,
    });
    registerConnector(mockMeta, mockConnectorFn);
    // NOTE: no credentials set

    const ws = await Workspace.create(wsDir);
    const { tree } = ws.loadDoc("tasks.codoc");

    // Force field to re-evaluate (clear previous resolved state)
    tree.refreshField("/tasks");

    await expect(tree.observe("/tasks")).rejects.toMatchObject({
      kind: "source",
      message: "飞书认证未配置：缺少 appId 或 appSecret",
    });

    expect(tree.getField("/tasks")!.state.status).toBe("error");
  });

  it("DAG propagation: connector field → downstream $ref field", async () => {
    mockConnectorFn.mockResolvedValue([{ name: "Task 1" }]);
    registerConnector(mockMeta, mockConnectorFn);
    getCredentialStore().set("mock-api", { token: "t" });

    const ws = await Workspace.create(wsDir);

    const yaml = `type:
  properties:
    raw:
      type: array
    count:
      type: array
data:
  raw:
    $source:
      connector: mock-api
      endpoint: /items
    ttl: 30
  count:
    $ref: "/raw"
view: "# Items"`;

    await ws.createDoc("items.codoc", yaml);
    const { tree, dag } = ws.loadDoc("items.codoc");

    // scheduleForce resolves fields in dependency order
    const result = await scheduleForce(tree, dag);

    // Both fields should be resolved
    expect(result.resolved).toContain("/raw");
    expect(result.resolved).toContain("/count");

    // /count ($ref to /raw) should have the same value as /raw
    const rawValue = tree.getField("/raw")!.state;
    const countValue = tree.getField("/count")!.state;
    expect(rawValue.status).toBe("resolved");
    expect(countValue.status).toBe("resolved");
    if (rawValue.status === "resolved" && countValue.status === "resolved") {
      expect(countValue.value).toEqual(rawValue.value);
    }
  });

  it("workspace change events fire when connector field resolves", async () => {
    mockConnectorFn.mockResolvedValue([{ data: "fresh" }]);
    registerConnector(mockMeta, mockConnectorFn);
    getCredentialStore().set("mock-api", { token: "t" });

    const ws = await Workspace.create(wsDir);

    // Reuse tasks.codoc
    const { tree } = ws.loadDoc("tasks.codoc");
    tree.refreshField("/tasks");

    const events: Array<{ docId: string; fieldPath: string }> = [];
    ws.onFieldChange((e) => {
      events.push({ docId: e.docId, fieldPath: e.fieldPath });
    });

    await tree.observe("/tasks");

    // Should have fired a change event for /tasks
    expect(events.some((e) => e.docId === "tasks.codoc" && e.fieldPath === "/tasks")).toBe(true);
  });
});
