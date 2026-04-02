import { describe, expect, it } from "vitest";
import { executeSource } from "../src/source-executor.js";

describe("executeSource", () => {
  it("returns static value directly", async () => {
    const result = await executeSource({ type: "static", value: { x: 1 } });
    expect(result).toEqual({ x: 1 });
  });

  it("returns null static value", async () => {
    const result = await executeSource({ type: "static", value: null });
    expect(result).toBeNull();
  });
});
