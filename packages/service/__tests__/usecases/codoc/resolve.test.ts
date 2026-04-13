import type { CodocAST, CodocPath, DataField, FieldName, FieldSchema } from "@cobook/core";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { resolveDataFields } from "../../../src/usecases/codoc/resolve.js";
import { parseRef } from "@cobook/core";

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

describe("resolveDataFields", () => {
  it("passes static values through", () => {
    const ast = makeAst({ score: { kind: "static", value: 4 } });
    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({}),
    );
    expect(result).toEqual({ score: 4 });
  });

  it("resolves a ref to an existing static field", () => {
    const targetAst = makeAst({ score: { kind: "static", value: 5 } });
    const sourceAst = makeAst({
      alice_score: ref("./reviews/alice.codoc#data.score"),
    });

    const lookup = makeLookup({
      "calibration.codoc": sourceAst,
      "reviews/alice.codoc": targetAst,
    });

    const result = resolveDataFields(
      { path: mkCodocPath("calibration.codoc"), ast: sourceAst },
      lookup,
    );
    expect(result).toEqual({ alice_score: 5 });
  });

  it("returns null for a ref to a missing codoc", () => {
    const sourceAst = makeAst({
      x: ref("./missing.codoc#data.score"),
    });
    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      makeLookup({ "a.codoc": sourceAst }),
    );
    // Only value is null → entire result is null
    expect(result).toBeNull();
  });

  it("returns null for a ref to a missing field", () => {
    const targetAst = makeAst({ other: { kind: "static", value: 1 } });
    const sourceAst = makeAst({
      x: ref("./target.codoc#data.nonexistent"),
    });

    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "target.codoc": targetAst,
    });

    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
    );
    expect(result).toBeNull();
  });

  it("returns null for a ref to another ref (depth > 1)", () => {
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

    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
    );
    // ref→ref → null; no static values → entire result is null
    expect(result).toBeNull();
  });

  it("returns null for a ref to a source field", () => {
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

    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
    );
    expect(result).toBeNull();
  });

  it("returns null for an empty data map", () => {
    const ast = makeAst({});
    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({}),
    );
    expect(result).toBeNull();
  });

  it("returns null for source fields", () => {
    const ast = makeAst({
      feed: { kind: "source", source: "rss", params: {} },
    });
    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast },
      makeLookup({}),
    );
    expect(result).toBeNull();
  });

  it("mixes static and ref fields", () => {
    const targetAst = makeAst({ val: { kind: "static", value: "hello" } });
    const sourceAst = makeAst({
      local: { kind: "static", value: 42 },
      remote: ref("./target.codoc#data.val"),
      broken: ref("./missing.codoc#data.x"),
    });

    const lookup = makeLookup({
      "a.codoc": sourceAst,
      "target.codoc": targetAst,
    });

    const result = resolveDataFields(
      { path: mkCodocPath("a.codoc"), ast: sourceAst },
      lookup,
    );
    expect(result).toEqual({
      local: 42,
      remote: "hello",
      broken: null,
    });
  });
});
