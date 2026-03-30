import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import { SourceScheduler } from "../source-scheduler.js";
import { clearSourceCache } from "../loader/source.js";
import { registerConnector, clearConnectorRegistry } from "../connector/registry.js";
import { getCredentialStore } from "../connector/credential-store.js";
import type { ConnectorMeta } from "../connector/types.js";

const mockConnectorFn = vi.fn();

const connectorMeta: ConnectorMeta = {
  name: "test-src",
  displayName: "Test",
  description: "test",
  configSchema: {},
  authSchema: {},
  exampleYaml: "",
};

function buildConnectorFixture(refresh?: "eager" | "lazy") {
  const tree = new DataTree({
    type: {
      properties: {
        raw: { type: "array" },
        derived: { type: "array" },
      },
    },
    data: {
      raw: {
        $source: {
          connector: "test-src",
          appToken: "abc",
          tableId: "tbl1",
        },
        ttl: 10,
        ...(refresh ? { refresh } : {}),
      },
      derived: { $ref: "/raw" },
    },
  });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

describe("SourceScheduler with connector fields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSourceCache();
    clearConnectorRegistry();
    getCredentialStore().clear();
    mockConnectorFn.mockReset();
    registerConnector(connectorMeta, mockConnectorFn);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers timers for connector $source fields with TTL", () => {
    const { tree, dag } = buildConnectorFixture();
    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    expect(scheduler.size).toBe(1);
    scheduler.dispose();
  });

  it("lazy refresh marks connector field as dirty", async () => {
    const { tree, dag } = buildConnectorFixture();
    mockConnectorFn.mockResolvedValue([{ name: "task1" }]);

    await tree.observe("/raw");
    expect(tree.getField("/raw")!.state.status).toBe("resolved");

    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    const cb = vi.fn();
    tree.subscribeField("/raw", cb);

    vi.advanceTimersByTime(10_000);

    expect(tree.getField("/raw")!.state.status).toBe("dirty");
    expect(cb).toHaveBeenCalled();
    // No new connector call — lazy doesn't re-fetch
    expect(mockConnectorFn).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it("eager refresh evicts cache and re-fetches via connector", async () => {
    const { tree, dag } = buildConnectorFixture("eager");
    mockConnectorFn
      .mockResolvedValueOnce([{ v: 1 }])
      .mockResolvedValueOnce([{ v: 2 }]);

    await tree.observe("/raw");
    expect(tree.getField("/raw")!.state).toEqual({
      status: "resolved",
      value: [{ v: 1 }],
    });

    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.dispose();

    expect(mockConnectorFn).toHaveBeenCalledTimes(2);
    expect(tree.getField("/raw")!.state).toEqual({
      status: "resolved",
      value: [{ v: 2 }],
    });
  });

  it("propagates dirty to downstream after connector refresh", async () => {
    const { tree, dag } = buildConnectorFixture();
    mockConnectorFn.mockResolvedValue([{ v: 1 }]);

    await tree.observe("/raw");
    await tree.observe("/derived");

    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    const derivedCb = vi.fn();
    tree.subscribeField("/derived", derivedCb);

    vi.advanceTimersByTime(10_000);

    expect(tree.getField("/derived")!.state.status).toBe("dirty");
    expect(derivedCb).toHaveBeenCalled();

    scheduler.dispose();
  });
});
