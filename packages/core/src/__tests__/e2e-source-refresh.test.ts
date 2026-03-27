import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import {
  DocRegistry,
  setDocRegistry,
  getDocRegistry,
} from "../doc-registry.js";
import { wireExternalDeps } from "../cross-doc-propagator.js";
import { SourceScheduler } from "../source-scheduler.js";
import { clearSourceCache } from "../loader/source.js";

/**
 * End-to-end test: SourceScheduler TTL expiry → cross-doc propagation.
 *
 * Simulates the real scenario:
 *   user.codoc has recentActivity ($source, ttl: 10)
 *   order.codoc has userActivity ($ref: "[[user.codoc]]/recentActivity")
 *
 * On TTL expiry:
 *   1. SourceScheduler invalidates user:/recentActivity
 *   2. Cross-doc subscription fires → order:/userActivity invalidated
 *   3. Re-observe gets fresh value
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeUserDoc() {
  return new DataTree({
    type: {
      properties: {
        name: { type: "string" },
        recentActivity: { type: "object" },
      },
    },
    data: {
      name: "Alice",
      recentActivity: {
        $source: "https://api.example.com/user/5/activity",
        ttl: 10,
      },
    },
  });
}

function makeOrderDoc() {
  return new DataTree({
    type: {
      properties: {
        orderId: { type: "string" },
        userActivity: { type: "object" },
      },
    },
    data: {
      orderId: "ORD-001",
      userActivity: {
        $ref: "[[user.codoc]]/recentActivity",
      },
    },
  });
}

describe("E2E: $source TTL refresh → cross-doc propagation", () => {
  let registry: DocRegistry;
  let savedRegistry: ReturnType<typeof getDocRegistry>;

  beforeEach(() => {
    vi.useFakeTimers();
    clearSourceCache();
    mockFetch.mockReset();
    savedRegistry = getDocRegistry();
    registry = new DocRegistry();
    setDocRegistry(registry);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedRegistry) setDocRegistry(savedRegistry);
  });

  it("order.codoc userActivity refreshes when user.codoc recentActivity TTL expires (lazy)", async () => {
    // --- Setup docs ---
    const userTree = makeUserDoc();
    const userDag = DAG.buildFromTree(userTree);
    registry.register("user.codoc", userTree, userDag);

    const orderTree = makeOrderDoc();
    const orderDag = DAG.buildFromTree(orderTree);
    registry.register("order.codoc", orderTree, orderDag);

    // Wire cross-doc subscriptions
    wireExternalDeps(registry, "order.codoc");

    // --- Initial force ---
    mockFetch.mockResolvedValueOnce(jsonResponse({ login: "alice", posts: 3 }));

    await userTree.observe("/name");
    await userTree.observe("/recentActivity");
    await orderTree.observe("/orderId");
    await orderTree.observe("/userActivity");

    expect(userTree.getField("/recentActivity")!.state).toEqual({
      status: "resolved",
      value: { login: "alice", posts: 3 },
    });
    expect(orderTree.getField("/userActivity")!.state).toEqual({
      status: "resolved",
      value: { login: "alice", posts: 3 },
    });

    // --- Start scheduler ---
    const scheduler = new SourceScheduler({ tree: userTree, dag: userDag });
    scheduler.registerAll();

    // Subscribe to order's userActivity to detect cross-doc propagation
    const orderCb = vi.fn();
    orderTree.subscribeField("/userActivity", orderCb);

    // --- Advance past TTL (10s) ---
    // Lazy strategy: invalidates user:/recentActivity, which triggers
    // cross-doc subscription → invalidates order:/userActivity
    vi.advanceTimersByTime(10_000);

    // user:/recentActivity should be dirty
    expect(userTree.getField("/recentActivity")!.state.status).toBe("dirty");

    // Wait for async cross-doc propagation callback
    await vi.advanceTimersByTimeAsync(100);

    // order:/userActivity should also be invalidated via cross-doc subscription
    const orderState = orderTree.getField("/userActivity")!.state.status;
    expect(orderCb).toHaveBeenCalled();
    // After cross-doc propagation, order's field is either dirty or re-resolved
    expect(["dirty", "resolved", "pending"]).toContain(orderState);

    // --- Re-observe with fresh data ---
    mockFetch.mockResolvedValueOnce(jsonResponse({ login: "alice", posts: 7 }));

    const freshValue = await userTree.observe("/recentActivity");
    expect(freshValue).toEqual({ login: "alice", posts: 7 });

    // order should also get fresh value after re-observe
    const freshOrderValue = await orderTree.observe("/userActivity");
    expect(freshOrderValue).toEqual({ login: "alice", posts: 7 });

    scheduler.dispose();
  });

  it("multiple TTL cycles keep refreshing", async () => {
    const userTree = makeUserDoc();
    const userDag = DAG.buildFromTree(userTree);
    registry.register("user.codoc", userTree, userDag);

    // Initial fetch
    mockFetch.mockResolvedValueOnce(jsonResponse({ v: 1 }));
    await userTree.observe("/recentActivity");

    const scheduler = new SourceScheduler({ tree: userTree, dag: userDag });
    scheduler.registerAll();

    const cb = vi.fn();
    userTree.subscribeField("/recentActivity", cb);

    // First TTL expiry
    vi.advanceTimersByTime(10_000);
    expect(userTree.getField("/recentActivity")!.state.status).toBe("dirty");
    expect(cb).toHaveBeenCalledTimes(1);

    // Re-resolve so next invalidation works
    mockFetch.mockResolvedValueOnce(jsonResponse({ v: 2 }));
    await userTree.observe("/recentActivity");
    expect(userTree.getField("/recentActivity")!.state.status).toBe("resolved");

    // Second TTL expiry
    vi.advanceTimersByTime(10_000);
    expect(userTree.getField("/recentActivity")!.state.status).toBe("dirty");
    expect(cb).toHaveBeenCalledTimes(3); // dirty + resolved + dirty

    scheduler.dispose();
  });

  it("scheduler dispose stops TTL refreshes", async () => {
    const userTree = makeUserDoc();
    const userDag = DAG.buildFromTree(userTree);
    registry.register("user.codoc", userTree, userDag);

    mockFetch.mockResolvedValueOnce(jsonResponse({ v: 1 }));
    await userTree.observe("/recentActivity");

    const scheduler = new SourceScheduler({ tree: userTree, dag: userDag });
    scheduler.registerAll();
    scheduler.dispose();

    const cb = vi.fn();
    userTree.subscribeField("/recentActivity", cb);

    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
    expect(userTree.getField("/recentActivity")!.state.status).toBe("resolved");
  });
});
