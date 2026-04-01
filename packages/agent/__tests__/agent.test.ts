import { describe, expect, it } from "vitest";
import { AGENT_VERSION } from "../src/index.js";

describe("@cobook/agent", () => {
  it("exports version", () => {
    expect(AGENT_VERSION).toBe("0.0.0");
  });
});
