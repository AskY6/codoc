import { describe, expect, it } from "vitest";
import { createSourceRegistry } from "../src/source-executor.js";

describe("SourceRegistry", () => {
  it("routes execute() to a registered provider and returns data", async () => {
    const registry = createSourceRegistry();
    registry.register({
      name: "test",
      resolve: async (params) => ({ data: { echo: params } }),
    });
    const result = await registry.execute("test", { x: 1 });
    expect(result).toEqual({ echo: { x: 1 } });
  });

  it("throws SourceError for unknown sources", async () => {
    const registry = createSourceRegistry();
    await expect(registry.execute("nope", {})).rejects.toThrow(
      'Unknown source: "nope"',
    );
  });

  it("passes empty params when none provided", async () => {
    const registry = createSourceRegistry();
    registry.register({
      name: "minimal",
      resolve: async () => ({ data: "ok" }),
    });
    const result = await registry.execute("minimal", {});
    expect(result).toBe("ok");
  });

  it("accepts an initial provider list in the factory", async () => {
    const registry = createSourceRegistry([
      { name: "seeded", resolve: async () => ({ data: 42 }) },
    ]);
    expect(await registry.execute("seeded", {})).toBe(42);
  });

  it("returns independent registries per call (no shared state)", async () => {
    const a = createSourceRegistry();
    const b = createSourceRegistry();
    a.register({ name: "only-in-a", resolve: async () => ({ data: "a" }) });
    await expect(b.execute("only-in-a", {})).rejects.toThrow(
      'Unknown source: "only-in-a"',
    );
  });
});
