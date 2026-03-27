import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocRegistry } from "../doc-registry.js";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";

function makeSimpleDoc() {
  const tree = new DataTree({
    type: { properties: { title: { type: "string" } } },
    data: { title: "Hello" },
  });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

describe("DocRegistry", () => {
  let registry: DocRegistry;

  beforeEach(() => {
    registry = new DocRegistry();
  });

  it("registers and retrieves a doc", () => {
    const { tree, dag } = makeSimpleDoc();
    registry.register("A.codoc", tree, dag);

    expect(registry.has("A.codoc")).toBe(true);
    expect(registry.get("A.codoc")).toEqual({ tree, dag });
  });

  it("returns undefined for unregistered doc", () => {
    expect(registry.get("missing.codoc")).toBeUndefined();
    expect(registry.has("missing.codoc")).toBe(false);
  });

  it("lists all doc IDs", () => {
    const a = makeSimpleDoc();
    const b = makeSimpleDoc();
    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    expect(registry.getAllDocIds().sort()).toEqual(["A.codoc", "B.codoc"]);
  });

  it("unregisters a doc", () => {
    const { tree, dag } = makeSimpleDoc();
    registry.register("A.codoc", tree, dag);
    registry.unregister("A.codoc");

    expect(registry.has("A.codoc")).toBe(false);
  });

  it("tracks consumers via addConsumer", () => {
    const a = makeSimpleDoc();
    const b = makeSimpleDoc();
    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    registry.addConsumer("B.codoc", "/title", "A.codoc", "/ref_b_title", vi.fn());

    const consumers = registry.getConsumers("B.codoc", "/title");
    expect(consumers).toEqual([{ docId: "A.codoc", fieldPath: "/ref_b_title" }]);
  });

  it("returns empty consumers for untracked field", () => {
    expect(registry.getConsumers("X.codoc", "/field")).toEqual([]);
  });

  it("calls onTargetChange when target field changes", () => {
    const a = makeSimpleDoc();
    const b = makeSimpleDoc();
    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const onChange = vi.fn();
    registry.addConsumer("B.codoc", "/title", "A.codoc", "/ref_b_title", onChange);

    // Force B's title to resolved first
    b.tree.updateField("/title", "Changed");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("cleans up subscriptions on unregister", () => {
    const a = makeSimpleDoc();
    const b = makeSimpleDoc();
    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const onChange = vi.fn();
    registry.addConsumer("B.codoc", "/title", "A.codoc", "/ref_b_title", onChange);

    // Unregister consumer doc A
    registry.unregister("A.codoc");

    // Change B's title — onChange should NOT fire (subscription cleaned up)
    b.tree.updateField("/title", "After unregister");
    expect(onChange).toHaveBeenCalledTimes(0);
  });
});
