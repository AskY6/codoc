import { describe, it, expect, vi } from "vitest";
import { refLoader } from "../loader/ref.js";
import type { CodataField, ForceContext } from "../types.js";

function makeRefField(ref: string, path = "/test"): CodataField {
  return {
    path,
    meta: { loader: { type: "ref", $ref: ref } },
    state: { status: "idle" },
  };
}

describe("ref loader", () => {
  it("delegates to context.force with the target path", async () => {
    const forceFn = vi.fn().mockResolvedValue("resolved-value");
    const context: ForceContext = {
      force: forceFn,
      forceStack: new Set(),
    };
    const field = makeRefField("/data/name");
    const result = await refLoader(field, context);
    expect(forceFn).toHaveBeenCalledWith("/data/name");
    expect(result).toBe("resolved-value");
  });

  it("throws cyclic_ref error when target is in force stack", async () => {
    const context: ForceContext = {
      force: vi.fn(),
      forceStack: new Set(["/a", "/b", "/data/name"]),
    };
    const field = makeRefField("/data/name", "/c");
    await expect(refLoader(field, context)).rejects.toMatchObject({
      kind: "cyclic_ref",
      path: "/c",
    });
  });

  it("throws if called on non-ref field", async () => {
    const field: CodataField = {
      path: "/test",
      meta: { loader: { type: "literal", value: 42 } },
      state: { status: "idle" },
    };
    const context: ForceContext = {
      force: vi.fn(),
      forceStack: new Set(),
    };
    await expect(refLoader(field, context)).rejects.toThrow("non-ref");
  });
});
