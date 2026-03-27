import { describe, it, expect, vi } from "vitest";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import { propagateAndInvalidate } from "../dirty-propagator.js";

/**
 * Tests that dirty propagation triggers subscription callbacks on downstream nodes.
 * This validates the chain: propagateAndInvalidate → invalidateField → notify → callback
 */

function buildChainFixture() {
  // A → B → C (B refs A, C refs B)
  const tree = new DataTree({
    type: {
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "string" },
      },
    },
    data: {
      a: "hello",
      b: { $ref: "/a" },
      c: { $ref: "/b" },
    },
  });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

function buildDiamondFixture() {
  // A → B, A → C, B → D, C → D (diamond)
  const tree = new DataTree({
    type: {
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "string" },
        d: { type: "string" },
      },
    },
    data: {
      a: "root",
      b: { $ref: "/a" },
      c: { $ref: "/a" },
      d: { $ref: "/b" },
    },
  });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

describe("subscribe + dirty propagation", () => {
  it("downstream subscriber is called when upstream changes propagate", async () => {
    const { tree, dag } = buildChainFixture();
    await tree.observe("/a");
    await tree.observe("/b");
    await tree.observe("/c");

    const cbB = vi.fn();
    const cbC = vi.fn();
    tree.subscribeField("/b", cbB);
    tree.subscribeField("/c", cbC);

    // Change A → propagate marks B and C dirty
    tree.updateField("/a", "world");
    propagateAndInvalidate(dag, tree, ["/a"]);

    expect(cbB).toHaveBeenCalled();
    expect(cbC).toHaveBeenCalled();
  });

  it("unsubscribed callback is NOT called during propagation", async () => {
    const { tree, dag } = buildChainFixture();
    await tree.observe("/a");
    await tree.observe("/b");

    const cb = vi.fn();
    const unsub = tree.subscribeField("/b", cb);
    unsub();

    tree.updateField("/a", "world");
    propagateAndInvalidate(dag, tree, ["/a"]);

    expect(cb).not.toHaveBeenCalled();
  });

  it("diamond dependency: each node notified exactly once", async () => {
    const { tree, dag } = buildDiamondFixture();
    await tree.observe("/a");
    await tree.observe("/b");
    await tree.observe("/c");
    await tree.observe("/d");

    const cbB = vi.fn();
    const cbC = vi.fn();
    const cbD = vi.fn();
    tree.subscribeField("/b", cbB);
    tree.subscribeField("/c", cbC);
    tree.subscribeField("/d", cbD);

    tree.updateField("/a", "changed");
    propagateAndInvalidate(dag, tree, ["/a"]);

    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbC).toHaveBeenCalledTimes(1);
    expect(cbD).toHaveBeenCalledTimes(1);
  });

  it("global subscriber is called once per invalidated node", async () => {
    const { tree, dag } = buildChainFixture();
    await tree.observe("/a");
    await tree.observe("/b");
    await tree.observe("/c");

    const globalCb = vi.fn();
    tree.subscribe(globalCb);

    // updateField notifies once, then propagate invalidates B and C (2 more)
    propagateAndInvalidate(dag, tree, ["/a"]);

    expect(globalCb).toHaveBeenCalledTimes(2); // /b dirty + /c dirty
  });

  it("independent nodes are NOT notified", async () => {
    const tree = new DataTree({
      type: {
        properties: {
          a: { type: "string" },
          b: { type: "string" },
          x: { type: "number" },
        },
      },
      data: {
        a: "hello",
        b: { $ref: "/a" },
        x: 42,
      },
    });
    const dag = DAG.buildFromTree(tree);
    await tree.observe("/a");
    await tree.observe("/b");
    await tree.observe("/x");

    const cbX = vi.fn();
    tree.subscribeField("/x", cbX);

    propagateAndInvalidate(dag, tree, ["/a"]);

    expect(cbX).not.toHaveBeenCalled();
  });

  it("idle/pending nodes are not invalidated (no spurious notify)", async () => {
    const { tree, dag } = buildChainFixture();
    // Only resolve /a, leave /b and /c idle
    await tree.observe("/a");

    const cbB = vi.fn();
    tree.subscribeField("/b", cbB);

    propagateAndInvalidate(dag, tree, ["/a"]);

    // /b is idle, invalidateField returns false, no notify
    expect(cbB).not.toHaveBeenCalled();
  });
});
