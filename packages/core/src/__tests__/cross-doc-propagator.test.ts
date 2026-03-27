import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildDocDAG,
  detectDocCycle,
  docDAGtoDot,
} from "../cross-doc-propagator.js";
import { DocRegistry, setDocRegistry } from "../doc-registry.js";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";

function makeDoc(data: Record<string, unknown>) {
  const type: Record<string, unknown> = { properties: {} };
  for (const key of Object.keys(data)) {
    (type.properties as Record<string, unknown>)[key] = { type: "string" };
  }
  const tree = new DataTree({ type, data });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

describe("buildDocDAG", () => {
  let registry: DocRegistry;

  beforeEach(() => {
    registry = new DocRegistry();
    setDocRegistry(registry);
  });

  it("returns empty graph for no docs", () => {
    const result = buildDocDAG(registry);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("builds a graph with cross-doc edges", () => {
    // A.codoc has an external ref to B.codoc's /title
    const a = makeDoc({
      localField: "hello",
      refB: { $ref: "[[B.codoc]]/title" },
    });
    const b = makeDoc({ title: "From B" });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const { nodes, edges } = buildDocDAG(registry);
    expect(nodes.sort()).toEqual(["A.codoc", "B.codoc"]);
    expect(edges).toEqual([{ from: "A.codoc", to: "B.codoc" }]);
  });

  it("deduplicates edges when multiple fields ref the same doc", () => {
    const a = makeDoc({
      ref1: { $ref: "[[B.codoc]]/title" },
      ref2: { $ref: "[[B.codoc]]/count" },
    });
    const b = makeDoc({ title: "B", count: "42" });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const { edges } = buildDocDAG(registry);
    expect(edges).toHaveLength(1);
  });
});

describe("detectDocCycle", () => {
  let registry: DocRegistry;

  beforeEach(() => {
    registry = new DocRegistry();
    setDocRegistry(registry);
  });

  it("returns null for acyclic graph", () => {
    const a = makeDoc({ refB: { $ref: "[[B.codoc]]/title" } });
    const b = makeDoc({ title: "B" });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    expect(detectDocCycle(registry)).toBeNull();
  });

  it("detects A → B → A cycle", () => {
    const a = makeDoc({ refB: { $ref: "[[B.codoc]]/title" } });
    const b = makeDoc({ refA: { $ref: "[[A.codoc]]/refB" } });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const cycle = detectDocCycle(registry);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3); // A → B → A
    // Cycle should start and end with the same node
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
  });

  it("detects A → B → C → A cycle", () => {
    const a = makeDoc({ refB: { $ref: "[[B.codoc]]/field" } });
    const b = makeDoc({ refC: { $ref: "[[C.codoc]]/field" } });
    const c = makeDoc({ refA: { $ref: "[[A.codoc]]/refB" } });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);
    registry.register("C.codoc", c.tree, c.dag);

    const cycle = detectDocCycle(registry);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
  });
});

describe("docDAGtoDot", () => {
  it("generates valid DOT output", () => {
    const registry = new DocRegistry();
    setDocRegistry(registry);

    const a = makeDoc({ refB: { $ref: "[[B.codoc]]/title" } });
    const b = makeDoc({ title: "B" });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const dot = docDAGtoDot(registry);
    expect(dot).toContain("digraph");
    expect(dot).toContain('"A.codoc"');
    expect(dot).toContain('"B.codoc"');
    expect(dot).toContain('"A.codoc" -> "B.codoc"');
  });
});
