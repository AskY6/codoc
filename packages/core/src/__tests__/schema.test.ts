import { describe, it, expect } from "vitest";
import { validate } from "../schema.js";

describe("schema validation", () => {
  it("validates a string value against string schema", () => {
    const result = validate({ type: "string" }, "hello", "/title");
    expect(result).toEqual({ ok: true, value: "hello" });
  });

  it("validates a number value against number schema", () => {
    const result = validate({ type: "number" }, 42, "/count");
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("validates an object against object schema", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };
    const result = validate(schema, { name: "Alice", age: 30 }, "/user");
    expect(result.ok).toBe(true);
  });

  it("returns validation error for type mismatch", () => {
    const result = validate({ type: "number" }, "not-a-number", "/count");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.path).toBe("/count");
      expect(result.error.message).toContain("must be number");
    }
  });

  it("returns validation error for missing required property", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = validate(schema, {}, "/user");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.message).toContain("name");
    }
  });

  it("validates arrays", () => {
    const schema = { type: "array", items: { type: "number" } };
    expect(validate(schema, [1, 2, 3], "/nums").ok).toBe(true);
    expect(validate(schema, [1, "two", 3], "/nums").ok).toBe(false);
  });
});
