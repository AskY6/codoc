import { describe, it, expect } from "vitest";
import { getLoader, registerLoader } from "../loader/registry.js";
import type { LoaderFn } from "../types.js";

describe("loader registry", () => {
  it("returns builtin literal loader", () => {
    const loader = getLoader({ type: "literal", value: 42 });
    expect(loader).toBeDefined();
    expect(typeof loader).toBe("function");
  });

  it("returns builtin ref loader", () => {
    const loader = getLoader({ type: "ref", $ref: "/path" });
    expect(loader).toBeDefined();
    expect(typeof loader).toBe("function");
  });

  it("throws for unknown loader type", () => {
    expect(() =>
      getLoader({ type: "unknown" } as any)
    ).toThrow("No loader registered for type: unknown");
  });

  it("registers and retrieves custom loader", () => {
    const myLoader: LoaderFn = async () => "custom";
    registerLoader("my-type", myLoader);
    const loader = getLoader({ type: "my-type" } as any);
    expect(loader).toBe(myLoader);
  });
});
