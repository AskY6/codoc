import { describe, it, expect } from "vitest";
import { propagateDirty, propagateAndInvalidate } from "../dirty-propagator.js";
import { DAG } from "../dag.js";
import { DataTree } from "../data-tree.js";

describe("propagateDirty", () => {
  it("returns empty for node with no dependents", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    expect(propagateDirty(dag, ["/b"])).toEqual([]);
  });

  it("marks direct dependents as dirty", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a"); // b depends on a
    dag.addEdge("/c", "/a"); // c depends on a
    const dirty = propagateDirty(dag, ["/a"]);
    expect(dirty.sort()).toEqual(["/b", "/c"]);
  });

  it("does not mark independent nodes as dirty", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addNode("/d"); // independent
    const dirty = propagateDirty(dag, ["/a"]);
    expect(dirty).toEqual(["/b"]);
    expect(dirty).not.toContain("/d");
  });

  it("propagates transitively through chains", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a"); // b depends on a
    dag.addEdge("/c", "/b"); // c depends on b
    dag.addEdge("/d", "/c"); // d depends on c
    const dirty = propagateDirty(dag, ["/a"]);
    expect(dirty).toEqual(["/b", "/c", "/d"]);
  });

  it("returns dirty set in topological order", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addEdge("/c", "/a");
    dag.addEdge("/d", "/b");
    dag.addEdge("/d", "/c");
    const dirty = propagateDirty(dag, ["/a"]);
    // b and c must come before d
    expect(dirty.indexOf("/d")).toBeGreaterThan(dirty.indexOf("/b"));
    expect(dirty.indexOf("/d")).toBeGreaterThan(dirty.indexOf("/c"));
  });

  it("handles diamond dependency without duplicates", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addEdge("/c", "/a");
    dag.addEdge("/d", "/b");
    dag.addEdge("/d", "/c");
    const dirty = propagateDirty(dag, ["/a"]);
    // No duplicates
    expect(dirty.length).toBe(new Set(dirty).size);
    expect(dirty).toContain("/b");
    expect(dirty).toContain("/c");
    expect(dirty).toContain("/d");
  });

  it("handles multiple changed paths", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addEdge("/d", "/c");
    const dirty = propagateDirty(dag, ["/a", "/c"]);
    expect(dirty.sort()).toEqual(["/b", "/d"]);
  });

  it("does not include the changed nodes themselves", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    const dirty = propagateDirty(dag, ["/a"]);
    expect(dirty).not.toContain("/a");
  });
});

describe("propagateAndInvalidate", () => {
  it("marks downstream fields as dirty on DataTree", async () => {
    const tree = new DataTree({
      type: {
        properties: {
          a: { type: "string" },
          b: { type: "string" },
          c: { type: "number" },
        },
      },
      data: {
        a: "hello",
        b: { $ref: "/a" },
        c: 42,
      },
    });

    // Force all fields first
    await tree.observe("/a");
    await tree.observe("/b");
    await tree.observe("/c");
    expect(tree.getField("/a")!.state.status).toBe("resolved");
    expect(tree.getField("/b")!.state.status).toBe("resolved");
    expect(tree.getField("/c")!.state.status).toBe("resolved");

    const dag = DAG.buildFromTree(tree);
    const dirty = propagateAndInvalidate(dag, tree, ["/a"]);

    expect(dirty).toEqual(["/b"]);
    expect(tree.getField("/b")!.state.status).toBe("dirty");
    // /a itself is not invalidated by propagation
    expect(tree.getField("/a")!.state.status).toBe("resolved");
    // /c is independent, should remain resolved
    expect(tree.getField("/c")!.state.status).toBe("resolved");
  });

  it("dirty fields can be re-observed to get new values", async () => {
    const tree = new DataTree({
      type: {
        properties: {
          a: { type: "string" },
          b: { type: "string" },
        },
      },
      data: {
        a: "original",
        b: { $ref: "/a" },
      },
    });

    await tree.observe("/b");
    expect(await tree.observe("/b")).toBe("original");

    const dag = DAG.buildFromTree(tree);
    propagateAndInvalidate(dag, tree, ["/a"]);

    expect(tree.getField("/b")!.state.status).toBe("dirty");
    // Re-observe should re-force
    const value = await tree.observe("/b");
    expect(value).toBe("original"); // same value since /a hasn't actually changed
    expect(tree.getField("/b")!.state.status).toBe("resolved");
  });
});
