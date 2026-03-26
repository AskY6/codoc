import { describe, it, expect } from "vitest";
import { topoSort, topoLayers } from "../topo-sort.js";
import { DAG } from "../dag.js";

describe("topoSort", () => {
  it("returns empty array for empty graph", () => {
    const dag = new DAG();
    expect(topoSort(dag)).toEqual([]);
  });

  it("returns single node", () => {
    const dag = new DAG();
    dag.addNode("/a");
    expect(topoSort(dag)).toEqual(["/a"]);
  });

  it("returns correct order for linear chain", () => {
    const dag = new DAG();
    dag.addEdge("/c", "/b"); // c depends on b
    dag.addEdge("/b", "/a"); // b depends on a
    const result = topoSort(dag);
    expect(result.indexOf("/a")).toBeLessThan(result.indexOf("/b"));
    expect(result.indexOf("/b")).toBeLessThan(result.indexOf("/c"));
  });

  it("returns correct order for diamond dependency", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addEdge("/c", "/a");
    dag.addEdge("/d", "/b");
    dag.addEdge("/d", "/c");
    const result = topoSort(dag);
    expect(result.indexOf("/a")).toBeLessThan(result.indexOf("/b"));
    expect(result.indexOf("/a")).toBeLessThan(result.indexOf("/c"));
    expect(result.indexOf("/b")).toBeLessThan(result.indexOf("/d"));
    expect(result.indexOf("/c")).toBeLessThan(result.indexOf("/d"));
  });

  it("throws CyclicDependencyError for cyclic graph", () => {
    const dag = new DAG();
    dag.addEdge("/a", "/b");
    dag.addEdge("/b", "/a");
    expect(() => topoSort(dag)).toThrow();
    try {
      topoSort(dag);
    } catch (err: any) {
      expect(err.kind).toBe("cyclic_dependency");
    }
  });
});

describe("topoLayers", () => {
  it("returns empty array for empty graph", () => {
    const dag = new DAG();
    expect(topoLayers(dag)).toEqual([]);
  });

  it("returns single layer for independent nodes", () => {
    const dag = new DAG();
    dag.addNode("/a");
    dag.addNode("/b");
    dag.addNode("/c");
    const layers = topoLayers(dag);
    expect(layers.length).toBe(1);
    expect(layers[0].sort()).toEqual(["/a", "/b", "/c"]);
  });

  it("groups correctly: A(no deps), B(→A), C(→A) → [[A], [B, C]]", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a"); // b depends on a
    dag.addEdge("/c", "/a"); // c depends on a
    const layers = topoLayers(dag);
    expect(layers.length).toBe(2);
    expect(layers[0]).toEqual(["/a"]);
    expect(layers[1].sort()).toEqual(["/b", "/c"]);
  });

  it("groups correctly for linear chain: [[A], [B], [C]]", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addEdge("/c", "/b");
    const layers = topoLayers(dag);
    expect(layers.length).toBe(3);
    expect(layers[0]).toEqual(["/a"]);
    expect(layers[1]).toEqual(["/b"]);
    expect(layers[2]).toEqual(["/c"]);
  });

  it("groups correctly for diamond: [[A], [B, C], [D]]", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addEdge("/c", "/a");
    dag.addEdge("/d", "/b");
    dag.addEdge("/d", "/c");
    const layers = topoLayers(dag);
    expect(layers.length).toBe(3);
    expect(layers[0]).toEqual(["/a"]);
    expect(layers[1].sort()).toEqual(["/b", "/c"]);
    expect(layers[2]).toEqual(["/d"]);
  });

  it("handles disconnected subgraphs", () => {
    const dag = new DAG();
    dag.addEdge("/b", "/a");
    dag.addNode("/x"); // independent
    const layers = topoLayers(dag);
    expect(layers.length).toBe(2);
    expect(layers[0].sort()).toEqual(["/a", "/x"]);
    expect(layers[1]).toEqual(["/b"]);
  });

  it("throws CyclicDependencyError for cyclic graph", () => {
    const dag = new DAG();
    dag.addEdge("/a", "/b");
    dag.addEdge("/b", "/c");
    dag.addEdge("/c", "/a");
    expect(() => topoLayers(dag)).toThrow();
    try {
      topoLayers(dag);
    } catch (err: any) {
      expect(err.kind).toBe("cyclic_dependency");
    }
  });
});
