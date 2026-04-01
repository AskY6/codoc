import { describe, expect, it } from "vitest";
import {
  validateSchema,
  validateRefs,
  buildDAG,
  parseCodoc,
} from "../src/index.js";

describe("validateSchema", () => {
  it("returns valid for matching data", () => {
    const schema = {
      title: { type: "string" },
      count: { type: "number" },
    };
    const data = { title: "Hello", count: 42 };

    const result = validateSchema(schema, data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error for type mismatch", () => {
    const schema = {
      title: { type: "string" },
      count: { type: "number" },
    };
    const data = { title: "Hello", count: "not-a-number" };

    const result = validateSchema(schema, data);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe("count");
    expect(result.errors[0]!.message).toContain("number");
    expect(result.errors[0]!.message).toContain("string");
  });

  it("skips fields not present in data", () => {
    const schema = { title: { type: "string" }, missing: { type: "number" } };
    const data = { title: "Hello" };

    const result = validateSchema(schema, data);
    expect(result.valid).toBe(true);
  });

  it("validates arrays correctly", () => {
    const schema = { tags: { type: "array" } };

    expect(validateSchema(schema, { tags: ["a", "b"] }).valid).toBe(true);
    expect(validateSchema(schema, { tags: "not-array" }).valid).toBe(false);
  });

  it("validates objects correctly", () => {
    const schema = { info: { type: "object" } };

    expect(validateSchema(schema, { info: { a: 1 } }).valid).toBe(true);
    expect(validateSchema(schema, { info: "not-object" }).valid).toBe(false);
  });
});

describe("validateRefs", () => {
  it("returns valid when all refs resolve", () => {
    const codocs = new Map([
      ["a.codoc", parseCodoc("data:\n  value:\n    $ref: ./b.codoc#data.value")],
      ["b.codoc", parseCodoc("data:\n  value: 42")],
    ]);
    const dag = buildDAG(codocs);
    const result = validateRefs(dag);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error for dangling ref", () => {
    const codocs = new Map([
      ["a.codoc", parseCodoc("data:\n  value:\n    $ref: ./missing.codoc#data.x")],
    ]);
    const dag = buildDAG(codocs);
    const result = validateRefs(dag);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.to).toBe("missing.codoc#data.x");
    expect(result.errors[0]!.message).toContain("does not exist");
  });
});
