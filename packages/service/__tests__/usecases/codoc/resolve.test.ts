import type { CodocAST, CodocPath, DataField, FieldName, FieldSchema } from "@cobook/core";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { resolveDataFields } from "../../../src/usecases/codoc/resolve.js";
import { parseRef } from "@cobook/core";
import type { SourceProvider, SourceRegistry } from "../../../src/ports/source.js";

function makeAst(
  data: Record<string, DataField>,
  title: string | null = null,
): CodocAST {
  const dataMap = new Map<FieldName, DataField>();
  for (const [k, v] of Object.entries(data)) {
    dataMap.set(mkFieldName(k), v);
  }
  return {
    meta: {
      title,
      description: null,
      tags: [],
      schema: new Map<FieldName, FieldSchema>(),
    },
    data: dataMap,
    view: { kind: "empty" },
  };
}

function makeLookup(
  entries: Record<string, CodocAST>,
): ReadonlyMap<CodocPath, CodocAST> {
  const m = new Map<CodocPath, CodocAST>();
  for (const [k, v] of Object.entries(entries)) {
    m.set(mkCodocPath(k), v);
  }
  return m;
}

function ref(input: string): DataField {
  const r = parseRef(input);
  if (!r.ok) throw new Error(`bad test ref: ${input}`);
  return { kind: "ref", ref: r.value };
}

const emptyRegistry: SourceRegistry = new Map();

function makeRegistry(
  ...providers: SourceProvider[]
): SourceRegistry {
  return new Map(providers.map((p) => [p.name, p]));
}

describe("resolveDataFields", () => {
  it("passes static values through", async () => {
    const ast = makeAst({ score: { kind: "static", value: 4 } });
    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({ "a.codoc": ast }),
      emptyRegistry,
    );
    expect(result).toEqual({
      score: { kind: "ready", value: 4 },
    });
  });

  it("resolves a ref to an existing static field", async () => {
    const targetAst = makeAst({ score: { kind: "static", value: 5 } });
    const sourceAst = makeAst({
      alice_score: ref("./reviews/alice.codoc#data.score"),
    });

    const lookup = makeLookup({
      "calibration.codoc": sourceAst,
      "reviews/alice.codoc": targetAst,
    });

    const result = await resolveDataFields(
      { path: mkCodocPath("calibration.codoc"), ast: sourceAst },
      lookup,
      emptyRegistry,
    );
    expect(result).toEqual({
      alice_score: { kind: "ready", value: 5 },
    });
  });

  it("produces error for a ref to a missing codoc", async () => {
    const sourceAst = makeAst({
      x: ref("./missing.codoc#data.score"),
    });
    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      makeLookup({ "a.codoc": sourceAst }),
      emptyRegistry,
    );
    // DAG build fails (unknown target) → fallback → ref is error
    expect(result?.["x"]?.kind).toBe("error");
  });

  it("produces error for a ref to a missing field", async () => {
    const targetAst = makeAst({ other: { kind: "static", value: 1 } });
    const sourceAst = makeAst({
      x: ref("./target.codoc#data.nonexistent"),
    });

    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "target.codoc": targetAst,
    });

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
      emptyRegistry,
    );
    // DAG build fails (unknown target) → fallback → ref is error
    expect(result?.["x"]?.kind).toBe("error");
  });

  it("resolves transitive ref chain (ref → ref → static)", async () => {
    const midAst = makeAst({
      score: ref("./leaf.codoc#data.val"),
    });
    const sourceAst = makeAst({
      x: ref("./mid.codoc#data.score"),
    });

    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "mid.codoc": midAst,
      "leaf.codoc": makeAst({ val: { kind: "static", value: 99 } }),
    });

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
      emptyRegistry,
    );
    // Now resolves transitively (was null in slice 6)
    expect(result).toEqual({
      x: { kind: "ready", value: 99 },
    });
  });

  it("produces error for a ref to a source field without provider", async () => {
    const targetAst = makeAst({
      feed: { kind: "source", source: "rss", params: { url: "https://example.com" } },
    });
    const sourceAst = makeAst({
      x: ref("./target.codoc#data.feed"),
    });

    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "target.codoc": targetAst,
    });

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
      emptyRegistry,
    );
    // source not seeded → error propagates to ref
    expect(result?.["x"]?.kind).toBe("error");
  });

  it("returns null for an empty data map", async () => {
    const ast = makeAst({});
    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({}),
      emptyRegistry,
    );
    expect(result).toBeNull();
  });

  it("produces error for source fields without a registered provider", async () => {
    const ast = makeAst({
      feed: { kind: "source", source: "rss", params: {} },
    });
    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({ "a.codoc": ast }),
      emptyRegistry,
    );
    expect(result?.["feed"]?.kind).toBe("error");
  });

  it("resolves source fields via a registered provider", async () => {
    const ast = makeAst({
      feed: { kind: "source", source: "mock", params: { key: "abc" } },
    });

    const mockProvider: SourceProvider = {
      name: "mock",
      async execute(params) {
        return { data: params["key"] };
      },
    };

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({ "a.codoc": ast }),
      makeRegistry(mockProvider),
    );
    expect(result).toEqual({
      feed: { kind: "ready", value: { data: "abc" } },
    });
  });

  it("produces error when source provider throws", async () => {
    const ast = makeAst({
      feed: { kind: "source", source: "failing", params: {} },
    });

    const failingProvider: SourceProvider = {
      name: "failing",
      async execute() {
        throw new Error("network error");
      },
    };

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({ "a.codoc": ast }),
      makeRegistry(failingProvider),
    );
    expect(result?.["feed"]?.kind).toBe("error");
  });

  it("mixes static, ref, and source fields", async () => {
    const targetAst = makeAst({ val: { kind: "static", value: "hello" } });
    const sourceAst = makeAst({
      local: { kind: "static", value: 42 },
      remote: ref("./target.codoc#data.val"),
      fetched: { kind: "source", source: "mock", params: {} },
      broken: ref("./missing.codoc#data.x"),
    });

    const mockProvider: SourceProvider = {
      name: "mock",
      async execute() {
        return "fetched-value";
      },
    };

    // Note: broken ref means DAG build fails → fallback path
    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "target.codoc": targetAst,
    });

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
      makeRegistry(mockProvider),
    );
    expect(result?.["local"]).toEqual({ kind: "ready", value: 42 });
    // In fallback mode (DAG build failed), refs are errors
    expect(result?.["remote"]?.kind).toBe("error");
    expect(result?.["fetched"]).toEqual({ kind: "ready", value: "fetched-value" });
    expect(result?.["broken"]?.kind).toBe("error");
  });

  it("mixes static, ref, and source when DAG builds successfully", async () => {
    const targetAst = makeAst({ val: { kind: "static", value: "hello" } });
    const sourceAst = makeAst({
      local: { kind: "static", value: 42 },
      remote: ref("./target.codoc#data.val"),
      fetched: { kind: "source", source: "mock", params: {} },
    });

    const mockProvider: SourceProvider = {
      name: "mock",
      async execute() {
        return "fetched-value";
      },
    };

    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "target.codoc": targetAst,
    });

    const result = await resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
      makeRegistry(mockProvider),
    );
    expect(result).toEqual({
      local: { kind: "ready", value: 42 },
      remote: { kind: "ready", value: "hello" },
      fetched: { kind: "ready", value: "fetched-value" },
    });
  });
});
