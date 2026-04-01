import { describe, expect, it } from "vitest";
import { SERVICE_VERSION } from "../src/index.js";

describe("@cobook/service", () => {
  it("exports version", () => {
    expect(SERVICE_VERSION).toBe("0.0.0");
  });
});
