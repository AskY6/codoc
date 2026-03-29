import { describe, it, expect } from "vitest";
import { assembleContext } from "../context.js";
import type {
  ContextData,
  ContextRequirement,
  ContextSource,
  ContextSourceFactory,
  ResourceRef,
} from "../types.js";

function makeSource(kind: string, content: string, tokens?: number): ContextSource {
  return {
    kind,
    resolve: async () => ({ kind, content, tokens }),
  };
}

function makeFactory(kind: string): ContextSourceFactory {
  return {
    kind,
    create: (ref: ResourceRef) => ({
      kind,
      resolve: async () => ({
        kind,
        content: `snapshot of ${ref.id}`,
        tokens: 100,
      }),
    }),
  };
}

describe("assembleContext", () => {
  it("returns empty array when no requirements", async () => {
    const result = await assembleContext([], [], [], []);
    expect(result).toEqual([]);
  });

  it("matches direct sources by kind", async () => {
    const sources = [
      makeSource("chat-history", "msg1\nmsg2", 50),
      makeSource("unrelated", "nope", 10),
    ];
    const reqs: ContextRequirement[] = [
      { sourceKind: "chat-history", priority: "required" },
    ];

    const result = await assembleContext(reqs, sources, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("chat-history");
    expect(result[0].content).toBe("msg1\nmsg2");
  });

  it("creates sources from factory + active resource refs", async () => {
    const factory = makeFactory("codoc-snapshot");
    const refs: ResourceRef[] = [
      { kind: "codoc", id: "doc-1", label: "My Doc" },
      { kind: "codoc", id: "doc-2" },
    ];
    const reqs: ContextRequirement[] = [
      { sourceKind: "codoc-snapshot", priority: "required" },
    ];

    const result = await assembleContext(reqs, [], [factory], refs);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("snapshot of doc-1");
    expect(result[1].content).toBe("snapshot of doc-2");
  });

  it("combines direct sources and factory sources", async () => {
    const sources = [makeSource("chat-history", "history", 30)];
    const factory = makeFactory("codoc-snapshot");
    const refs: ResourceRef[] = [{ kind: "codoc", id: "doc-1" }];
    const reqs: ContextRequirement[] = [
      { sourceKind: "chat-history", priority: "required" },
      { sourceKind: "codoc-snapshot", priority: "optional" },
    ];

    const result = await assembleContext(reqs, sources, [factory], refs);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("chat-history");
    expect(result[1].kind).toBe("codoc-snapshot");
  });

  it("orders required before optional", async () => {
    const sources = [
      makeSource("optional-src", "opt", 10),
      makeSource("required-src", "req", 20),
    ];
    const reqs: ContextRequirement[] = [
      { sourceKind: "optional-src", priority: "optional" },
      { sourceKind: "required-src", priority: "required" },
    ];

    const result = await assembleContext(reqs, sources, [], []);
    expect(result[0].kind).toBe("required-src");
    expect(result[1].kind).toBe("optional-src");
  });

  it("trims optional sources when over total token budget", async () => {
    const sources = [
      makeSource("required", "r", 80),
      makeSource("opt-a", "a", 30),
      makeSource("opt-b", "b", 20),
    ];
    const reqs: ContextRequirement[] = [
      { sourceKind: "required", priority: "required" },
      { sourceKind: "opt-a", priority: "optional" },
      { sourceKind: "opt-b", priority: "optional" },
    ];

    // Budget is 100: required=80, only 20 left → opt-a (30) doesn't fit, opt-b (20) fits
    const result = await assembleContext(reqs, sources, [], [], 100);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("required");
    expect(result[1].kind).toBe("opt-b");
  });

  it("applies per-requirement maxTokens limit", async () => {
    const sources = [makeSource("big", "a]".repeat(500), 1000)];
    const reqs: ContextRequirement[] = [
      { sourceKind: "big", priority: "required", maxTokens: 100 },
    ];

    const result = await assembleContext(reqs, sources, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].tokens).toBe(100);
    expect(result[0].content.length).toBeLessThan(1000);
  });

  it("returns empty when no sources match requirements", async () => {
    const reqs: ContextRequirement[] = [
      { sourceKind: "nonexistent", priority: "optional" },
    ];
    const result = await assembleContext(reqs, [], [], []);
    expect(result).toEqual([]);
  });

  it("keeps all optional when within budget", async () => {
    const sources = [
      makeSource("a", "a", 30),
      makeSource("b", "b", 30),
    ];
    const reqs: ContextRequirement[] = [
      { sourceKind: "a", priority: "optional" },
      { sourceKind: "b", priority: "optional" },
    ];

    const result = await assembleContext(reqs, sources, [], [], 100);
    expect(result).toHaveLength(2);
  });
});
