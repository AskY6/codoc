import { describe, expect, it } from "vitest";
import { buildDAG, invalidate, parseCodoc } from "../src/index.js";

describe("invalidate", () => {
  function buildChain() {
    // A → B → C  (A depends on B, B depends on C)
    const codocs = new Map([
      ["c.codoc", parseCodoc("data:\n  value: 100")],
      ["b.codoc", parseCodoc("data:\n  value:\n    $ref: ./c.codoc#data.value")],
      ["a.codoc", parseCodoc("data:\n  value:\n    $ref: ./b.codoc#data.value")],
    ]);
    return buildDAG(codocs);
  }

  it("propagates from root to all downstream", () => {
    const dag = buildChain();
    const affected = invalidate(dag, "c.codoc#data.value");

    expect(affected).toContain("c.codoc#data.value");
    expect(affected).toContain("b.codoc#data.value");
    expect(affected).toContain("a.codoc#data.value");
    expect(affected).toHaveLength(3);
  });

  it("only returns leaf when invalidating a leaf", () => {
    const dag = buildChain();
    const affected = invalidate(dag, "a.codoc#data.value");

    expect(affected).toEqual(["a.codoc#data.value"]);
  });

  it("propagates from middle node", () => {
    const dag = buildChain();
    const affected = invalidate(dag, "b.codoc#data.value");

    expect(affected).toContain("b.codoc#data.value");
    expect(affected).toContain("a.codoc#data.value");
    expect(affected).not.toContain("c.codoc#data.value");
  });
});
