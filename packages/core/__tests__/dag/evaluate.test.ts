import type { CodocAST, CodocPath, DataField, FieldName, FieldSchema, NodeId } from "../../src/codoc/index.js";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "../../src/codoc/index.js";
import { parseRef } from "../../src/codoc/ref.js";
import { buildDAG } from "../../src/dag/build.js";
import { evaluate } from "../../src/dag/evaluate.js";
import { describe, expect, it } from "vitest";

function makeAst(
  data: Record<string, DataField>,
): CodocAST {
  const dataMap = new Map<FieldName, DataField>();
  for (const [k, v] of Object.entries(data)) {
    dataMap.set(mkFieldName(k), v);
  }
  return {
    meta: { title: null, description: null, tags: [], schema: new Map<FieldName, FieldSchema>() },
    data: dataMap,
    view: { kind: "empty" },
  };
}

function makeCodocs(
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

function buildOrThrow(codocs: ReadonlyMap<CodocPath, CodocAST>) {
  const r = buildDAG(codocs);
  if (!r.ok) throw new Error(`DAG build failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("evaluate", () => {
  it("resolves static fields", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({ x: { kind: "static", value: 42 } }),
    });
    const dag = buildOrThrow(codocs);
    const results = evaluate(dag, new Map());
    const r = results.get("a.codoc#data.x" as NodeId);
    expect(r).toEqual({ kind: "ready", value: 42 });
  });

  it("resolves a single ref hop", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({ y: ref("./b.codoc#data.val") }),
      "b.codoc": makeAst({ val: { kind: "static", value: "hello" } }),
    });
    const dag = buildOrThrow(codocs);
    const results = evaluate(dag, new Map());
    expect(results.get("a.codoc#data.y" as NodeId)).toEqual({
      kind: "ready",
      value: "hello",
    });
  });

  it("resolves transitive ref chains (ref → ref → static)", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({ z: ref("./b.codoc#data.mid") }),
      "b.codoc": makeAst({ mid: ref("./c.codoc#data.leaf") }),
      "c.codoc": makeAst({ leaf: { kind: "static", value: 99 } }),
    });
    const dag = buildOrThrow(codocs);
    const results = evaluate(dag, new Map());

    expect(results.get("a.codoc#data.z" as NodeId)).toEqual({
      kind: "ready",
      value: 99,
    });
    expect(results.get("b.codoc#data.mid" as NodeId)).toEqual({
      kind: "ready",
      value: 99,
    });
  });

  it("resolves source fields from pre-seeded values", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({
        feed: { kind: "source", source: "rss", params: { url: "https://x.com" } },
      }),
    });
    const dag = buildOrThrow(codocs);
    const sourceValues = new Map<NodeId, unknown>([
      ["a.codoc#data.feed" as NodeId, { items: [1, 2, 3] }],
    ]);
    const results = evaluate(dag, sourceValues);
    expect(results.get("a.codoc#data.feed" as NodeId)).toEqual({
      kind: "ready",
      value: { items: [1, 2, 3] },
    });
  });

  it("produces error for unseeded source fields", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({
        feed: { kind: "source", source: "rss", params: {} },
      }),
    });
    const dag = buildOrThrow(codocs);
    const results = evaluate(dag, new Map());
    const r = results.get("a.codoc#data.feed" as NodeId);
    expect(r?.kind).toBe("error");
  });

  it("produces error for cyclic nodes", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({ x: ref("./b.codoc#data.y") }),
      "b.codoc": makeAst({ y: ref("./a.codoc#data.x") }),
    });
    const dag = buildOrThrow(codocs);
    const results = evaluate(dag, new Map());

    const rx = results.get("a.codoc#data.x" as NodeId);
    const ry = results.get("b.codoc#data.y" as NodeId);
    expect(rx?.kind).toBe("error");
    expect(ry?.kind).toBe("error");
  });

  it("propagates error through ref chain when upstream fails", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({ top: ref("./b.codoc#data.mid") }),
      "b.codoc": makeAst({
        mid: ref("./c.codoc#data.src"),
      }),
      "c.codoc": makeAst({
        src: { kind: "source", source: "broken", params: {} },
      }),
    });
    const dag = buildOrThrow(codocs);
    // Don't seed the source → error
    const results = evaluate(dag, new Map());

    const src = results.get("c.codoc#data.src" as NodeId);
    expect(src?.kind).toBe("error");

    const mid = results.get("b.codoc#data.mid" as NodeId);
    expect(mid?.kind).toBe("error");
    if (mid?.kind === "error") {
      expect(mid.error.cause).not.toBeNull();
    }

    const top = results.get("a.codoc#data.top" as NodeId);
    expect(top?.kind).toBe("error");
    if (top?.kind === "error") {
      expect(top.error.cause).not.toBeNull();
    }
  });

  it("resolves ref pointing to a seeded source", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({ derived: ref("./b.codoc#data.feed") }),
      "b.codoc": makeAst({
        feed: { kind: "source", source: "http-json", params: { url: "https://api.example.com" } },
      }),
    });
    const dag = buildOrThrow(codocs);
    const sourceValues = new Map<NodeId, unknown>([
      ["b.codoc#data.feed" as NodeId, { count: 5 }],
    ]);
    const results = evaluate(dag, sourceValues);
    expect(results.get("a.codoc#data.derived" as NodeId)).toEqual({
      kind: "ready",
      value: { count: 5 },
    });
  });

  it("mixed: static + ref + source all resolve correctly", () => {
    const codocs = makeCodocs({
      "a.codoc": makeAst({
        local: { kind: "static", value: 1 },
        remote: ref("./b.codoc#data.val"),
        fetched: { kind: "source", source: "http-json", params: {} },
      }),
      "b.codoc": makeAst({ val: { kind: "static", value: 2 } }),
    });
    const dag = buildOrThrow(codocs);
    const sourceValues = new Map<NodeId, unknown>([
      ["a.codoc#data.fetched" as NodeId, "data"],
    ]);
    const results = evaluate(dag, sourceValues);

    expect(results.get("a.codoc#data.local" as NodeId)).toEqual({ kind: "ready", value: 1 });
    expect(results.get("a.codoc#data.remote" as NodeId)).toEqual({ kind: "ready", value: 2 });
    expect(results.get("a.codoc#data.fetched" as NodeId)).toEqual({ kind: "ready", value: "data" });
  });
});
