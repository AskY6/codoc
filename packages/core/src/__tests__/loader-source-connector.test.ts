import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sourceLoader,
  clearSourceCache,
  getSourceCacheSize,
  stableStringify,
  buildConnectorCacheKey,
} from "../loader/source.js";
import { registerConnector, clearConnectorRegistry } from "../connector/registry.js";
import { getCredentialStore } from "../connector/credential-store.js";
import { DataTree } from "../data-tree.js";
import type { CodataField, ForceContext, SourceConnectorConfig } from "../types.js";
import type { ConnectorMeta } from "../connector/types.js";

const dummyMeta: ConnectorMeta = {
  name: "mock-connector",
  displayName: "Mock",
  description: "mock",
  configSchema: {},
  authSchema: {},
  exampleYaml: "",
};

function makeConnectorField(
  source: SourceConnectorConfig,
  ttl?: number,
  swr?: boolean,
): CodataField {
  return {
    path: "/data",
    meta: {
      loader: {
        type: "source" as const,
        $source: source,
        ttl,
        staleWhileRevalidate: swr,
      },
    },
    state: { status: "idle" },
  };
}

const dummyContext: ForceContext = {
  force: async () => undefined,
  forceStack: new Set(),
};

describe("sourceLoader — connector path", () => {
  beforeEach(() => {
    clearSourceCache();
    clearConnectorRegistry();
    getCredentialStore().clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSourceCache();
    clearConnectorRegistry();
  });

  it("dispatches to registered connector", async () => {
    const mockFn = vi.fn().mockResolvedValue([{ name: "task1" }]);
    registerConnector(dummyMeta, mockFn);

    const field = makeConnectorField({
      connector: "mock-connector",
      appToken: "abc",
      tableId: "tbl1",
    });

    const result = await sourceLoader(field, dummyContext);
    expect(result).toEqual([{ name: "task1" }]);
    expect(mockFn).toHaveBeenCalledWith(
      { appToken: "abc", tableId: "tbl1" },
      undefined,
    );
  });

  it("passes auth from credential store to connector", async () => {
    const mockFn = vi.fn().mockResolvedValue({ ok: true });
    registerConnector(dummyMeta, mockFn);
    getCredentialStore().set("mock-connector", { token: "secret" });

    const field = makeConnectorField({ connector: "mock-connector", key: "val" });
    await sourceLoader(field, dummyContext);

    expect(mockFn).toHaveBeenCalledWith(
      { key: "val" },
      { token: "secret" },
    );
  });

  it("throws for unknown connector", async () => {
    const field = makeConnectorField({ connector: "nonexistent" });

    await expect(sourceLoader(field, dummyContext)).rejects.toMatchObject({
      kind: "source",
      message: 'Unknown connector: "nonexistent"',
      retryable: false,
    });
  });

  it("caches connector results within TTL", async () => {
    const mockFn = vi.fn().mockResolvedValue({ v: 1 });
    registerConnector(dummyMeta, mockFn);

    const field = makeConnectorField({ connector: "mock-connector", id: "1" }, 60);

    await sourceLoader(field, dummyContext);
    await sourceLoader(field, dummyContext);

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(getSourceCacheSize()).toBe(1);
  });

  it("refetches connector data after TTL expires", async () => {
    let call = 0;
    const mockFn = vi.fn().mockImplementation(async () => ({ v: ++call }));
    registerConnector(dummyMeta, mockFn);

    const field = makeConnectorField({ connector: "mock-connector" }, 0.1);

    await sourceLoader(field, dummyContext);
    expect(call).toBe(1);

    await new Promise((r) => setTimeout(r, 150));

    const result = await sourceLoader(field, dummyContext);
    expect(call).toBe(2);
    expect(result).toEqual({ v: 2 });
  });

  it("returns stale connector data during SWR", async () => {
    let resolveSecond: (v: unknown) => void;
    let call = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ v: 1 });
      return new Promise((res) => { resolveSecond = res; });
    });
    registerConnector(dummyMeta, mockFn);

    const field = makeConnectorField({ connector: "mock-connector" }, 0.1, true);

    const r1 = await sourceLoader(field, dummyContext);
    expect(r1).toEqual({ v: 1 });

    await new Promise((r) => setTimeout(r, 150));

    const r2 = await sourceLoader(field, dummyContext);
    expect(r2).toEqual({ v: 1 }); // stale
    expect(call).toBe(2); // background fetch started

    resolveSecond!({ v: 2 });
    await new Promise((r) => setTimeout(r, 10));

    const r3 = await sourceLoader(field, dummyContext);
    expect(r3).toEqual({ v: 2 });
  });

  it("propagates connector errors", async () => {
    const mockFn = vi.fn().mockRejectedValue({
      kind: "source",
      message: "飞书认证失败",
      retryable: false,
    });
    registerConnector(dummyMeta, mockFn);

    const field = makeConnectorField({ connector: "mock-connector" });

    await expect(sourceLoader(field, dummyContext)).rejects.toMatchObject({
      kind: "source",
      message: "飞书认证失败",
    });
  });
});

describe("DataTree parses connector $source", () => {
  it("resolves object $source as a source loader with connector config", () => {
    const tree = new DataTree({
      type: { properties: { tasks: { type: "array" } } },
      data: {
        tasks: {
          $source: { connector: "feishu-table", appToken: "abc", tableId: "tbl1" },
          ttl: 300,
          refresh: "lazy",
        },
      },
    });
    const field = tree.getField("/tasks");
    expect(field).toBeDefined();
    expect(field!.meta.loader).toEqual({
      type: "source",
      $source: { connector: "feishu-table", appToken: "abc", tableId: "tbl1" },
      ttl: 300,
      staleWhileRevalidate: undefined,
      refresh: "lazy",
    });
  });

  it("still resolves string $source as before", () => {
    const tree = new DataTree({
      type: { properties: { weather: { type: "object" } } },
      data: {
        weather: { $source: "https://example.com/api", ttl: 60 },
      },
    });
    const field = tree.getField("/weather");
    expect(field!.meta.loader).toEqual({
      type: "source",
      $source: "https://example.com/api",
      ttl: 60,
      staleWhileRevalidate: undefined,
      refresh: undefined,
    });
  });
});

describe("stableStringify", () => {
  it("produces consistent output regardless of key order", () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("handles nested objects", () => {
    const result = stableStringify({ z: { b: 2, a: 1 }, a: "x" });
    expect(result).toBe('{"a":"x","z":{"a":1,"b":2}}');
  });

  it("handles arrays", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles primitives", () => {
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("undefined");
  });
});

describe("buildConnectorCacheKey", () => {
  it("produces deterministic key for same config regardless of key order", () => {
    const a = buildConnectorCacheKey({ connector: "feishu-table", tableId: "t1", appToken: "a1" });
    const b = buildConnectorCacheKey({ connector: "feishu-table", appToken: "a1", tableId: "t1" });
    expect(a).toBe(b);
    expect(a).toContain("connector:feishu-table:");
  });

  it("excludes connector name from config hash", () => {
    const key = buildConnectorCacheKey({ connector: "x", id: "1" });
    // The stringified part should only contain {id: "1"}, not connector
    expect(key).toBe('connector:x:{"id":"1"}');
  });
});
