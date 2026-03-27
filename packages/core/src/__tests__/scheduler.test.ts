import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import { scheduleForce } from "../scheduler.js";
import { registerLoader } from "../loader/registry.js";
import type { LoaderFn } from "../types.js";

describe("scheduleForce", () => {
  it("resolves all fields in a simple tree", async () => {
    const tree = new DataTree({
      type: { properties: { a: { type: "number" }, b: { type: "number" } } },
      data: { a: 1, b: 2 },
    });
    const dag = DAG.buildFromTree(tree);

    const result = await scheduleForce(tree, dag);

    expect(result.resolved).toContain("/a");
    expect(result.resolved).toContain("/b");
    expect(result.errors).toHaveLength(0);
  });

  it("resolves fields with $ref deps in correct order", async () => {
    const tree = new DataTree({
      type: { properties: { a: { type: "number" }, b: { type: "number" } } },
      data: { a: 10, b: { $ref: "/a" } },
    });
    const dag = DAG.buildFromTree(tree);

    const result = await scheduleForce(tree, dag);

    expect(result.resolved).toEqual(["/a", "/b"]);
    expect(result.errors).toHaveLength(0);

    // Verify values
    const fieldA = tree.getField("/a");
    const fieldB = tree.getField("/b");
    expect(fieldA?.state).toEqual({ status: "resolved", value: 10 });
    expect(fieldB?.state).toEqual({ status: "resolved", value: 10 });
  });

  it("forces same-layer fields concurrently", async () => {
    const timestamps: Array<{ path: string; start: number; end: number }> = [];

    // Register a slow loader that takes 50ms
    const slowLoader: LoaderFn = async (field) => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      const end = Date.now();
      timestamps.push({ path: field.path, start, end });
      return `value-of-${field.path}`;
    };
    registerLoader("slow", slowLoader);

    // Create tree with 3 independent "slow" fields
    const tree = new DataTree({
      type: {
        properties: {
          x: { type: "string" },
          y: { type: "string" },
          z: { type: "string" },
        },
      },
      data: {
        x: { $source: "placeholder" },
        y: { $source: "placeholder" },
        z: { $source: "placeholder" },
      },
    });

    // Override loaders to use our slow loader
    for (const path of ["/x", "/y", "/z"]) {
      const field = tree.getField(path)!;
      field.meta.loader = { type: "slow" } as any;
    }

    const dag = DAG.buildFromTree(tree);

    const before = Date.now();
    const result = await scheduleForce(tree, dag);
    const elapsed = Date.now() - before;

    expect(result.resolved).toHaveLength(3);
    expect(result.errors).toHaveLength(0);

    // If executed in parallel, total time should be ~50ms, not ~150ms
    // Allow generous margin for CI flakiness
    expect(elapsed).toBeLessThan(120);

    // Verify all three started at roughly the same time
    if (timestamps.length === 3) {
      const starts = timestamps.map((t) => t.start);
      const spread = Math.max(...starts) - Math.min(...starts);
      expect(spread).toBeLessThan(30);
    }
  });

  it("captures errors without blocking other fields", async () => {
    registerLoader("fail", async () => {
      throw new Error("intentional failure");
    });

    const tree = new DataTree({
      type: {
        properties: {
          ok: { type: "number" },
          bad: { type: "string" },
        },
      },
      data: { ok: 42, bad: "will-fail" },
    });

    // Override "bad" to use failing loader
    tree.getField("/bad")!.meta.loader = { type: "fail" } as any;

    const dag = DAG.buildFromTree(tree);
    const result = await scheduleForce(tree, dag);

    expect(result.resolved).toContain("/ok");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("/bad");
  });

  it("times out slow fields", async () => {
    registerLoader("very-slow", async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return "too late";
    });

    const tree = new DataTree({
      type: { properties: { slow: { type: "string" } } },
      data: { slow: "x" },
    });
    tree.getField("/slow")!.meta.loader = { type: "very-slow" } as any;

    const dag = DAG.buildFromTree(tree);
    const result = await scheduleForce(tree, dag, { timeout: 100 });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("/slow");
    expect((result.errors[0].error as any).message).toContain("Timeout");
  });
});
