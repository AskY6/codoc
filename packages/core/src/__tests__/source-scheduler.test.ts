import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import { SourceScheduler } from "../source-scheduler.js";
import { clearSourceCache } from "../loader/source.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildSourceFixture(refresh?: "eager" | "lazy") {
  const tree = new DataTree({
    type: {
      properties: {
        raw: { type: "object" },
        derived: { type: "object" },
      },
    },
    data: {
      raw: {
        $source: "https://api.example.com/data",
        ttl: 10,
        ...(refresh ? { refresh } : {}),
      },
      derived: { $ref: "/raw" },
    },
  });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

describe("SourceScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSourceCache();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers timers for $source fields with TTL", () => {
    const { tree, dag } = buildSourceFixture();
    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    expect(scheduler.size).toBe(1);
    scheduler.dispose();
  });

  it("skips fields without TTL", () => {
    const tree = new DataTree({
      type: { properties: { x: { type: "string" } } },
      data: { x: { $source: "https://example.com", ttl: 0 } },
    });
    const dag = DAG.buildFromTree(tree);
    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    expect(scheduler.size).toBe(0);
    scheduler.dispose();
  });

  it("skips non-source fields", () => {
    const tree = new DataTree({
      type: { properties: { x: { type: "string" } } },
      data: { x: "literal" },
    });
    const dag = DAG.buildFromTree(tree);
    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    expect(scheduler.size).toBe(0);
    scheduler.dispose();
  });

  it("does not double-register", () => {
    const { tree, dag } = buildSourceFixture();
    const scheduler = new SourceScheduler({ tree, dag });

    expect(scheduler.register("/raw")).toBe(true);
    expect(scheduler.register("/raw")).toBe(false);
    expect(scheduler.size).toBe(1);
    scheduler.dispose();
  });

  describe("lazy strategy (default)", () => {
    it("invalidates field on TTL expiry without fetching", async () => {
      const { tree, dag } = buildSourceFixture();
      mockFetch.mockResolvedValue(jsonResponse({ v: 1 }));

      // Initial observe
      await tree.observe("/raw");
      expect(tree.getField("/raw")!.state.status).toBe("resolved");

      const scheduler = new SourceScheduler({ tree, dag });
      scheduler.registerAll();

      const cb = vi.fn();
      tree.subscribeField("/raw", cb);

      // Advance past TTL
      vi.advanceTimersByTime(10_000);

      expect(tree.getField("/raw")!.state.status).toBe("dirty");
      expect(cb).toHaveBeenCalledTimes(1);
      // No new fetch — lazy doesn't re-fetch
      expect(mockFetch).toHaveBeenCalledTimes(1); // only the initial observe

      scheduler.dispose();
    });

    it("propagates dirty to downstream on TTL expiry", async () => {
      const { tree, dag } = buildSourceFixture();
      mockFetch.mockResolvedValue(jsonResponse({ v: 1 }));

      await tree.observe("/raw");
      await tree.observe("/derived");

      const scheduler = new SourceScheduler({ tree, dag });
      scheduler.registerAll();

      const derivedCb = vi.fn();
      tree.subscribeField("/derived", derivedCb);

      vi.advanceTimersByTime(10_000);

      expect(tree.getField("/derived")!.state.status).toBe("dirty");
      expect(derivedCb).toHaveBeenCalledTimes(1);

      scheduler.dispose();
    });
  });

  describe("eager strategy", () => {
    it("evicts cache, re-fetches, and resolves on TTL expiry", async () => {
      const { tree, dag } = buildSourceFixture("eager");
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ v: 1 }))
        .mockResolvedValueOnce(jsonResponse({ v: 2 }));

      await tree.observe("/raw");
      expect(tree.getField("/raw")!.state).toEqual({
        status: "resolved",
        value: { v: 1 },
      });

      const scheduler = new SourceScheduler({ tree, dag });
      scheduler.registerAll();

      // Advance exactly one TTL tick, flushing the async observe chain
      await vi.advanceTimersByTimeAsync(10_000);
      // Stop the interval before it fires again
      scheduler.dispose();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(tree.getField("/raw")!.state).toEqual({
        status: "resolved",
        value: { v: 2 },
      });
    });

    it("propagates dirty to downstream after eager re-fetch", async () => {
      const { tree, dag } = buildSourceFixture("eager");
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ v: 1 }))
        .mockResolvedValueOnce(jsonResponse({ v: 2 }));

      await tree.observe("/raw");
      await tree.observe("/derived");

      const scheduler = new SourceScheduler({ tree, dag });
      scheduler.registerAll();

      const derivedCb = vi.fn();
      tree.subscribeField("/derived", derivedCb);

      await vi.advanceTimersByTimeAsync(10_000);
      scheduler.dispose();

      // derived should have been invalidated by propagation
      expect(derivedCb).toHaveBeenCalled();
    });

    it("handles fetch failure gracefully", async () => {
      const { tree, dag } = buildSourceFixture("eager");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ v: 1 }))
        .mockRejectedValueOnce(new Error("network down"));

      await tree.observe("/raw");

      const scheduler = new SourceScheduler({ tree, dag });
      scheduler.registerAll();

      await vi.advanceTimersByTimeAsync(10_000);
      scheduler.dispose();

      // Should log error, not crash
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  it("dispose() clears all timers", async () => {
    const { tree, dag } = buildSourceFixture();
    mockFetch.mockResolvedValue(jsonResponse({ v: 1 }));
    await tree.observe("/raw");

    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();
    expect(scheduler.size).toBe(1);

    scheduler.dispose();
    expect(scheduler.size).toBe(0);

    const cb = vi.fn();
    tree.subscribeField("/raw", cb);

    // Advance past TTL — no timer should fire
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("unregister() cancels a single timer", async () => {
    const { tree, dag } = buildSourceFixture();
    mockFetch.mockResolvedValue(jsonResponse({ v: 1 }));
    await tree.observe("/raw");

    const scheduler = new SourceScheduler({ tree, dag });
    scheduler.registerAll();

    scheduler.unregister("/raw");
    expect(scheduler.size).toBe(0);

    const cb = vi.fn();
    tree.subscribeField("/raw", cb);

    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();

    scheduler.dispose();
  });
});
