import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sourceLoader, clearSourceCache, getSourceCacheSize } from "../loader/source.js";
import type { CodataField, ForceContext } from "../types.js";

function makeField(url: string, ttl?: number, swr?: boolean): CodataField {
  return {
    path: "/weather",
    meta: {
      loader: {
        type: "source" as const,
        $source: url,
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

describe("sourceLoader", () => {
  beforeEach(() => {
    clearSourceCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSourceCache();
  });

  it("fetches JSON from URL", async () => {
    const data = { temp: 25 };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await sourceLoader(makeField("https://api.example.com/weather"), dummyContext);
    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/weather");
  });

  it("throws retryable error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    await expect(
      sourceLoader(makeField("https://api.example.com/fail"), dummyContext),
    ).rejects.toMatchObject({
      kind: "source",
      retryable: true,
      url: "https://api.example.com/fail",
    });
  });

  it("throws retryable error on 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    );

    await expect(
      sourceLoader(makeField("https://api.example.com/500"), dummyContext),
    ).rejects.toMatchObject({
      kind: "source",
      retryable: true,
    });
  });

  it("throws non-retryable error on 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      sourceLoader(makeField("https://api.example.com/404"), dummyContext),
    ).rejects.toMatchObject({
      kind: "source",
      retryable: false,
    });
  });

  it("caches within TTL", async () => {
    const data = { temp: 25 };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200 }),
    );

    const field = makeField("https://api.example.com/cached", 60);

    // First call — fetches
    await sourceLoader(field, dummyContext);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call — from cache
    const result2 = await sourceLoader(field, dummyContext);
    expect(result2).toEqual(data);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getSourceCacheSize()).toBe(1);
  });

  it("refetches after TTL expires", async () => {
    const data1 = { temp: 25 };
    const data2 = { temp: 30 };
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      const data = callCount === 1 ? data1 : data2;
      return new Response(JSON.stringify(data), { status: 200 });
    });

    // TTL = 0.1 seconds
    const field = makeField("https://api.example.com/short-ttl", 0.1);

    await sourceLoader(field, dummyContext);
    expect(callCount).toBe(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 150));

    const result = await sourceLoader(field, dummyContext);
    expect(callCount).toBe(2);
    expect(result).toEqual(data2);
  });

  it("returns stale value during stale-while-revalidate", async () => {
    const data1 = { temp: 25 };
    let resolveSecond: (v: Response) => void;
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify(data1), { status: 200 }));
      }
      return new Promise((resolve) => { resolveSecond = resolve; });
    });

    const field = makeField("https://api.example.com/swr", 0.1, true);

    // Initial fetch
    const result1 = await sourceLoader(field, dummyContext);
    expect(result1).toEqual(data1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 150));

    // Should return stale value immediately and trigger background refresh
    const result2 = await sourceLoader(field, dummyContext);
    expect(result2).toEqual(data1); // stale value
    expect(callCount).toBe(2); // background fetch started

    // Resolve background fetch
    const data2 = { temp: 30 };
    resolveSecond!(new Response(JSON.stringify(data2), { status: 200 }));
    await new Promise((r) => setTimeout(r, 10));

    // Next call should get fresh value
    const result3 = await sourceLoader(field, dummyContext);
    expect(result3).toEqual(data2);
  });

  it("throws if called on non-source field", async () => {
    const field: CodataField = {
      path: "/x",
      meta: { loader: { type: "literal", value: 1 } },
      state: { status: "idle" },
    };
    await expect(sourceLoader(field, dummyContext)).rejects.toThrow("non-source");
  });
});
