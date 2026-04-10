import { describe, expect, it, beforeEach } from "vitest";
import {
  executeSource,
  registerSource,
  _resetSourceRegistry,
} from "../src/source-executor.js";

beforeEach(() => {
  _resetSourceRegistry();
});

describe("executeSource", () => {
  it("routes to registered provider and returns data", async () => {
    registerSource({
      name: "test",
      resolve: async (params) => ({ data: { echo: params } }),
    });
    const result = await executeSource("test", { x: 1 });
    expect(result).toEqual({ echo: { x: 1 } });
  });

  it("throws SourceError for unknown source", async () => {
    await expect(executeSource("nope", {})).rejects.toThrow(
      'Unknown source: "nope"',
    );
  });

  it("passes empty params when none provided", async () => {
    registerSource({
      name: "minimal",
      resolve: async () => ({ data: "ok" }),
    });
    const result = await executeSource("minimal", {});
    expect(result).toBe("ok");
  });
});
