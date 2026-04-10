import { describe, expect, it } from "vitest";
import {
  buildDAG,
  makeNodeId,
  getUpstream,
  getDownstream,
  topoSort,
  detectCycles,
  parseCodoc,
} from "../src/index.js";

function buildThreeNodeDAG() {
  // C is standalone, B refs C, A refs B  →  A → B → C
  const codocs = new Map([
    ["c.codoc", parseCodoc("---\ndata:\n  value: 100\n---")],
    ["b.codoc", parseCodoc("---\ndata:\n  value:\n    $ref: ./c.codoc#data.value\n---")],
    ["a.codoc", parseCodoc("---\ndata:\n  value:\n    $ref: ./b.codoc#data.value\n---")],
  ]);

  return buildDAG(codocs);
}

describe("buildDAG", () => {
  it("creates nodes for each data field", () => {
    const dag = buildThreeNodeDAG();
    expect(dag.nodes.size).toBe(3);
    expect(dag.nodes.has("a.codoc#data.value")).toBe(true);
    expect(dag.nodes.has("b.codoc#data.value")).toBe(true);
    expect(dag.nodes.has("c.codoc#data.value")).toBe(true);
  });

  it("creates edges for $ref fields", () => {
    const dag = buildThreeNodeDAG();
    expect(dag.edges).toHaveLength(2);
  });

  it("skips codocs without data", () => {
    const codocs = new Map([
      ["empty.codoc", parseCodoc("---\nmeta:\n  title: Empty\n---")],
    ]);
    const dag = buildDAG(codocs);
    expect(dag.nodes.size).toBe(0);
    expect(dag.edges).toHaveLength(0);
  });
});

describe("makeNodeId", () => {
  it("produces correct format", () => {
    expect(makeNodeId("notes/meeting.codoc", "summary")).toBe(
      "notes/meeting.codoc#data.summary",
    );
  });
});

describe("getUpstream / getDownstream", () => {
  it("returns correct upstream (dependencies)", () => {
    const dag = buildThreeNodeDAG();
    expect(getUpstream(dag, "a.codoc#data.value")).toEqual([
      "b.codoc#data.value",
    ]);
    expect(getUpstream(dag, "c.codoc#data.value")).toEqual([]);
  });

  it("returns correct downstream (dependents)", () => {
    const dag = buildThreeNodeDAG();
    expect(getDownstream(dag, "c.codoc#data.value")).toEqual([
      "b.codoc#data.value",
    ]);
    expect(getDownstream(dag, "a.codoc#data.value")).toEqual([]);
  });
});

describe("topoSort", () => {
  it("returns dependency-first order", () => {
    const dag = buildThreeNodeDAG();
    const sorted = topoSort(dag);

    expect(sorted).toHaveLength(3);
    // C must come before B, B must come before A
    const idxC = sorted.indexOf("c.codoc#data.value");
    const idxB = sorted.indexOf("b.codoc#data.value");
    const idxA = sorted.indexOf("a.codoc#data.value");
    expect(idxC).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxA);
  });

  it("handles independent nodes in any order", () => {
    const codocs = new Map([
      ["x.codoc", parseCodoc("---\ndata:\n  val: 1\n---")],
      ["y.codoc", parseCodoc("---\ndata:\n  val: 2\n---")],
    ]);
    const dag = buildDAG(codocs);
    const sorted = topoSort(dag);
    expect(sorted).toHaveLength(2);
  });
});

describe("detectCycles", () => {
  it("returns empty for acyclic graph", () => {
    const dag = buildThreeNodeDAG();
    expect(detectCycles(dag)).toEqual([]);
  });

  it("detects A → B → A cycle", () => {
    const codocs = new Map([
      ["a.codoc", parseCodoc("---\ndata:\n  value:\n    $ref: ./b.codoc#data.value\n---")],
      ["b.codoc", parseCodoc("---\ndata:\n  value:\n    $ref: ./a.codoc#data.value\n---")],
    ]);

    const dag = buildDAG(codocs);
    const cycles = detectCycles(dag);

    expect(cycles.length).toBeGreaterThanOrEqual(1);
    // The cycle should contain both nodes
    const cycle = cycles[0]!;
    expect(cycle[0]).toBe(cycle[cycle.length - 1]); // loop closes
    expect(cycle).toContain("a.codoc#data.value");
    expect(cycle).toContain("b.codoc#data.value");
  });
});
