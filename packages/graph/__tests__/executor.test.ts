import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph/graph.js";
import { runGraph } from "../src/graph/executor.js";
import { END, NodeId } from "../src/graph/ids.js";
import type { NodeContext, GraphNode } from "../src/graph/node.js";
import type { StateReducers } from "../src/graph/state.js";

interface S {
  messages: readonly string[];
  value: number;
}

type E = string;

function makeCtx(events: E[] = []): NodeContext<E> {
  return {
    emit: (e) => events.push(e),
    signal: AbortSignal.timeout(5000),
  };
}

const reducers: StateReducers<S> = {
  messages: (prev, incoming) => [...prev, ...incoming],
};

describe("runGraph", () => {
  it("runs a simple two-node graph to END", async () => {
    const nodeA: GraphNode<S, E> = {
      id: NodeId("a"),
      run: async () => ({ messages: ["hello"] }),
    };
    const nodeB: GraphNode<S, E> = {
      id: NodeId("b"),
      run: async () => ({ value: 42 }),
    };
    const graph = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [nodeA, nodeB],
      edges: [
        { kind: "static", from: NodeId("a"), to: NodeId("b") },
        { kind: "static", from: NodeId("b"), to: END },
      ],
      reducers,
    });
    if (!graph.ok) throw new Error("graph build failed");

    const result = await runGraph(
      graph.value,
      { messages: [], value: 0 },
      makeCtx(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reachedEnd).toBe(true);
      expect(result.value.steps).toBe(2);
      expect(result.value.state.messages).toEqual(["hello"]);
      expect(result.value.state.value).toBe(42);
    }
  });

  it("routes via conditional edges", async () => {
    const router: GraphNode<S, E> = {
      id: NodeId("router"),
      run: async () => ({ value: 10 }),
    };
    const branchA: GraphNode<S, E> = {
      id: NodeId("branchA"),
      run: async () => ({ messages: ["took A"] }),
    };
    const branchB: GraphNode<S, E> = {
      id: NodeId("branchB"),
      run: async () => ({ messages: ["took B"] }),
    };
    const graph = buildGraph<S, E>({
      entry: NodeId("router"),
      nodes: [router, branchA, branchB],
      edges: [
        {
          kind: "conditional",
          from: NodeId("router"),
          branches: [
            { when: (s) => s.value > 5, to: NodeId("branchA") },
            { when: () => true, to: NodeId("branchB") },
          ],
        },
        { kind: "static", from: NodeId("branchA"), to: END },
        { kind: "static", from: NodeId("branchB"), to: END },
      ],
      reducers,
    });
    if (!graph.ok) throw new Error("graph build failed");

    const result = await runGraph(
      graph.value,
      { messages: [], value: 0 },
      makeCtx(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state.messages).toEqual(["took A"]);
    }
  });

  it("returns maxStepsExceeded when limit is hit", async () => {
    const node: GraphNode<S, E> = {
      id: NodeId("loop"),
      run: async () => ({}),
    };
    // No edge from "loop" but we set maxSteps to 0.
    const graph = buildGraph<S, E>({
      entry: NodeId("loop"),
      nodes: [node],
      edges: [{ kind: "static", from: NodeId("loop"), to: END }],
    });
    if (!graph.ok) throw new Error("graph build failed");

    const result = await runGraph(
      graph.value,
      { messages: [], value: 0 },
      makeCtx(),
      { maxSteps: 0 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("maxStepsExceeded");
    }
  });

  it("returns aborted when signal is already aborted", async () => {
    const node: GraphNode<S, E> = {
      id: NodeId("a"),
      run: async () => ({}),
    };
    const graph = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node],
      edges: [{ kind: "static", from: NodeId("a"), to: END }],
    });
    if (!graph.ok) throw new Error("graph build failed");

    const controller = new AbortController();
    controller.abort();

    const result = await runGraph(
      graph.value,
      { messages: [], value: 0 },
      { emit: () => {}, signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("aborted");
    }
  });

  it("returns nodeThrew when a node throws", async () => {
    const node: GraphNode<S, E> = {
      id: NodeId("bad"),
      run: async () => {
        throw new Error("boom");
      },
    };
    const graph = buildGraph<S, E>({
      entry: NodeId("bad"),
      nodes: [node],
      edges: [{ kind: "static", from: NodeId("bad"), to: END }],
    });
    if (!graph.ok) throw new Error("graph build failed");

    const result = await runGraph(
      graph.value,
      { messages: [], value: 0 },
      makeCtx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("nodeThrew");
      expect((result.error as { cause: unknown }).cause).toBeInstanceOf(Error);
    }
  });

  it("collects events emitted by nodes", async () => {
    const events: E[] = [];
    const node: GraphNode<S, E> = {
      id: NodeId("a"),
      run: async (_state, ctx) => {
        ctx.emit("event-1");
        ctx.emit("event-2");
        return {};
      },
    };
    const graph = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node],
      edges: [{ kind: "static", from: NodeId("a"), to: END }],
    });
    if (!graph.ok) throw new Error("graph build failed");

    await runGraph(graph.value, { messages: [], value: 0 }, makeCtx(events));

    expect(events).toEqual(["event-1", "event-2"]);
  });

  it("returns noMatchingBranch when no conditional branch matches", async () => {
    const node: GraphNode<S, E> = {
      id: NodeId("a"),
      run: async () => ({}),
    };
    const graph = buildGraph<S, E>({
      entry: NodeId("a"),
      nodes: [node],
      edges: [
        {
          kind: "conditional",
          from: NodeId("a"),
          branches: [{ when: () => false, to: END }],
        },
      ],
    });
    if (!graph.ok) throw new Error("graph build failed");

    const result = await runGraph(
      graph.value,
      { messages: [], value: 0 },
      makeCtx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("noMatchingBranch");
    }
  });
});
