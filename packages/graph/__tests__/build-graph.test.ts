import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph/graph.js";
import { END, NodeId } from "../src/graph/ids.js";
import type { GraphNode } from "../src/graph/node.js";
import type { Edge } from "../src/graph/edge.js";

type S = { value: number };
type E = string;

const noop: GraphNode<S, E>["run"] = async () => ({});

function node(id: string): GraphNode<S, E> {
  return { id: NodeId(id), run: noop };
}

describe("buildGraph", () => {
  it("builds a valid two-node graph", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a"), node("b")],
      edges: [
        { kind: "static", from: NodeId("a"), to: NodeId("b") },
        { kind: "static", from: NodeId("b"), to: END },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entry).toBe(NodeId("a"));
      expect(result.value.nodes.size).toBe(2);
    }
  });

  it("rejects duplicate node ids", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a"), node("a")],
      edges: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("duplicateNode");
    }
  });

  it("rejects unknown entry", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("missing"),
      nodes: [node("a")],
      edges: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknownEntry");
    }
  });

  it("rejects edge from unknown node", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a")],
      edges: [{ kind: "static", from: NodeId("ghost"), to: END }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("edgeFromUnknown");
    }
  });

  it("rejects edge to unknown node", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a")],
      edges: [{ kind: "static", from: NodeId("a"), to: NodeId("ghost") }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("edgeToUnknown");
    }
  });

  it("rejects unreachable nodes", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a"), node("b"), node("island")],
      edges: [
        { kind: "static", from: NodeId("a"), to: NodeId("b") },
        { kind: "static", from: NodeId("b"), to: END },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unreachableNode");
    }
  });

  it("detects cycles", () => {
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a"), node("b")],
      edges: [
        { kind: "static", from: NodeId("a"), to: NodeId("b") },
        { kind: "static", from: NodeId("b"), to: NodeId("a") },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("cycleDetected");
    }
  });

  it("accepts conditional edges", () => {
    const edges: Edge<S>[] = [
      {
        kind: "conditional",
        from: NodeId("a"),
        branches: [
          { when: (s) => s.value > 0, to: NodeId("b") },
          { when: () => true, to: END },
        ],
      },
      { kind: "static", from: NodeId("b"), to: END },
    ];
    const result = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node("a"), node("b")],
      edges,
    });
    expect(result.ok).toBe(true);
  });
});
