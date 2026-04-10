import { describe, expect, it } from "vitest";
import { createBaseAgent, toolDefinitions } from "../src/index.js";

describe("@cobook/agent", () => {
  it("exports createBaseAgent", () => {
    expect(typeof createBaseAgent).toBe("function");
  });

  it("creates an agent with run method", () => {
    const agent = createBaseAgent();
    expect(typeof agent.run).toBe("function");
  });

  it("exports tool definitions", () => {
    expect(toolDefinitions.length).toBeGreaterThan(0);
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("listCodocs");
    expect(names).toContain("getCodoc");
    expect(names).toContain("createCodoc");
    expect(names).toContain("updateCodoc");
    expect(names).toContain("getWorkspaceStatus");
  });
});
