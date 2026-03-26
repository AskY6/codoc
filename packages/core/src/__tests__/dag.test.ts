import { describe, it, expect } from "vitest";
import { DAG } from "../dag.js";
import { DataTree } from "../data-tree.js";

describe("DAG", () => {
  describe("node operations", () => {
    it("adds and checks nodes", () => {
      const dag = new DAG();
      dag.addNode("/a");
      dag.addNode("/b");
      expect(dag.hasNode("/a")).toBe(true);
      expect(dag.hasNode("/b")).toBe(true);
      expect(dag.hasNode("/c")).toBe(false);
    });

    it("removes a node and cleans up edges", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a"); // b depends on a
      dag.addEdge("/c", "/a"); // c depends on a
      dag.removeNode("/a");
      expect(dag.hasNode("/a")).toBe(false);
      expect(dag.getDirectDeps("/b")).toEqual([]);
      expect(dag.getDirectDeps("/c")).toEqual([]);
    });

    it("returns all nodes", () => {
      const dag = new DAG();
      dag.addNode("/a");
      dag.addNode("/b");
      dag.addNode("/c");
      expect(dag.getNodes().sort()).toEqual(["/a", "/b", "/c"]);
    });
  });

  describe("edge operations", () => {
    it("adds edges and tracks deps/dependents", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a"); // b depends on a
      expect(dag.getDirectDeps("/b")).toEqual(["/a"]);
      expect(dag.getDependents("/a")).toEqual(["/b"]);
    });

    it("removes edges", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a");
      dag.removeEdge("/b", "/a");
      expect(dag.getDirectDeps("/b")).toEqual([]);
      expect(dag.getDependents("/a")).toEqual([]);
    });

    it("handles multiple dependencies", () => {
      const dag = new DAG();
      dag.addEdge("/c", "/a");
      dag.addEdge("/c", "/b");
      expect(dag.getDirectDeps("/c").sort()).toEqual(["/a", "/b"]);
      expect(dag.getDependents("/a")).toEqual(["/c"]);
      expect(dag.getDependents("/b")).toEqual(["/c"]);
    });
  });

  describe("cycle detection", () => {
    it("returns null for acyclic graph", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a");
      dag.addEdge("/c", "/a");
      expect(dag.detectCycle()).toBeNull();
    });

    it("returns null for empty graph", () => {
      const dag = new DAG();
      expect(dag.detectCycle()).toBeNull();
    });

    it("returns null for single node", () => {
      const dag = new DAG();
      dag.addNode("/a");
      expect(dag.detectCycle()).toBeNull();
    });

    it("detects A → B → A cycle", () => {
      const dag = new DAG();
      dag.addEdge("/a", "/b");
      dag.addEdge("/b", "/a");
      const err = dag.detectCycle();
      expect(err).not.toBeNull();
      expect(err!.kind).toBe("cyclic_dependency");
      expect(err!.cycle.length).toBeGreaterThanOrEqual(2);
    });

    it("detects A → B → C → A cycle with path info", () => {
      const dag = new DAG();
      dag.addEdge("/a", "/b");
      dag.addEdge("/b", "/c");
      dag.addEdge("/c", "/a");
      const err = dag.detectCycle();
      expect(err).not.toBeNull();
      expect(err!.kind).toBe("cyclic_dependency");
      expect(err!.cycle.length).toBeGreaterThanOrEqual(3);
      // The cycle should form a loop
      expect(err!.cycle[0]).toBe(err!.cycle[err!.cycle.length - 1]);
    });

    it("detects cycle even with acyclic nodes present", () => {
      const dag = new DAG();
      dag.addNode("/x"); // independent
      dag.addEdge("/a", "/b");
      dag.addEdge("/b", "/c");
      dag.addEdge("/c", "/a");
      const err = dag.detectCycle();
      expect(err).not.toBeNull();
    });
  });

  describe("buildFromTree", () => {
    it("builds DAG from DataTree with $ref dependencies", () => {
      const tree = new DataTree({
        type: {
          properties: {
            title: { type: "string" },
            count: { type: "number" },
            summary: { type: "string" },
          },
        },
        data: {
          title: "Hello",
          count: 42,
          summary: { $ref: "/title" },
        },
      });

      const dag = DAG.buildFromTree(tree);
      expect(dag.hasNode("/title")).toBe(true);
      expect(dag.hasNode("/count")).toBe(true);
      expect(dag.hasNode("/summary")).toBe(true);
      expect(dag.getDirectDeps("/summary")).toEqual(["/title"]);
      expect(dag.getDependents("/title")).toEqual(["/summary"]);
      expect(dag.detectCycle()).toBeNull();
    });

    it("builds DAG from chained refs", () => {
      const tree = new DataTree({
        type: {
          properties: {
            a: { type: "string" },
            b: { type: "string" },
            c: { type: "string" },
          },
        },
        data: {
          a: "origin",
          b: { $ref: "/a" },
          c: { $ref: "/b" },
        },
      });

      const dag = DAG.buildFromTree(tree);
      expect(dag.getDirectDeps("/c")).toEqual(["/b"]);
      expect(dag.getDirectDeps("/b")).toEqual(["/a"]);
      expect(dag.getDirectDeps("/a")).toEqual([]);
      expect(dag.detectCycle()).toBeNull();
    });

    it("detects cycle in DataTree", () => {
      const tree = new DataTree({
        type: {
          properties: {
            a: { type: "string" },
            b: { type: "string" },
            c: { type: "string" },
          },
        },
        data: {
          a: { $ref: "/b" },
          b: { $ref: "/c" },
          c: { $ref: "/a" },
        },
      });

      const dag = DAG.buildFromTree(tree);
      const err = dag.detectCycle();
      expect(err).not.toBeNull();
      expect(err!.kind).toBe("cyclic_dependency");
    });
  });

  describe("toDot", () => {
    it("generates valid DOT output", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a");
      dag.addEdge("/c", "/a");
      const dot = dag.toDot();
      expect(dot).toContain("digraph");
      expect(dot).toContain('"/a" -> "/b"');
      expect(dot).toContain('"/a" -> "/c"');
    });

    it("accepts custom title", () => {
      const dag = new DAG();
      dag.addNode("/x");
      const dot = dag.toDot({ title: "My Graph" });
      expect(dot).toContain('"My Graph"');
    });

    it("highlights dirty nodes", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a");
      const dot = dag.toDot({ highlightDirty: ["/b"] });
      expect(dot).toContain('"/b" [fillcolor="#ffcccc"');
      expect(dot).not.toContain('"/a" [fillcolor="#ffcccc"');
    });
  });

  describe("incremental updates", () => {
    it("correctly updates after adding a new node with edge", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a");
      // Add a new node that depends on /a
      dag.addEdge("/c", "/a");
      expect(dag.getDependents("/a").sort()).toEqual(["/b", "/c"]);
      expect(dag.detectCycle()).toBeNull();
    });

    it("correctly updates after removing a node", () => {
      const dag = new DAG();
      dag.addEdge("/b", "/a");
      dag.addEdge("/c", "/b");
      // Remove middle node
      dag.removeNode("/b");
      expect(dag.hasNode("/b")).toBe(false);
      expect(dag.getDirectDeps("/c")).toEqual([]);
      expect(dag.getDependents("/a")).toEqual([]);
    });
  });
});
