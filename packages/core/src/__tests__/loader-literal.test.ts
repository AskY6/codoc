import { describe, it, expect } from "vitest";
import { literalLoader } from "../loader/literal.js";
import type { CodataField, ForceContext } from "../types.js";

function makeField(value: unknown, path = "/test"): CodataField {
  return {
    path,
    meta: { loader: { type: "literal", value } },
    state: { status: "idle" },
  };
}

const dummyContext: ForceContext = {
  force: async () => undefined,
  forceStack: new Set(),
};

describe("literal loader", () => {
  it("returns a string value", async () => {
    const result = await literalLoader(makeField("hello"), dummyContext);
    expect(result).toBe("hello");
  });

  it("returns a number value", async () => {
    const result = await literalLoader(makeField(42), dummyContext);
    expect(result).toBe(42);
  });

  it("returns null", async () => {
    const result = await literalLoader(makeField(null), dummyContext);
    expect(result).toBeNull();
  });

  it("returns an object value", async () => {
    const obj = { a: 1, b: "two" };
    const result = await literalLoader(makeField(obj), dummyContext);
    expect(result).toEqual(obj);
  });

  it("returns an array value", async () => {
    const arr = [1, 2, 3];
    const result = await literalLoader(makeField(arr), dummyContext);
    expect(result).toEqual(arr);
  });

  it("throws if called on a non-literal field", async () => {
    const field: CodataField = {
      path: "/test",
      meta: { loader: { type: "ref", $ref: "/other" } },
      state: { status: "idle" },
    };
    await expect(literalLoader(field, dummyContext)).rejects.toThrow(
      "non-literal"
    );
  });
});
