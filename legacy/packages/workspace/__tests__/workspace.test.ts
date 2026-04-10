import { describe, expect, it } from "vitest";
import { WORKSPACE_VERSION } from "../src/index.js";

describe("@cobook/workspace", () => {
  it("exports version", () => {
    expect(WORKSPACE_VERSION).toBe("0.0.0");
  });
});
