import { describe, expect, it } from "vitest";
import { NodeState, InvalidTransition } from "../src/index.js";

describe("NodeState", () => {
  it("starts in idle state", () => {
    const state = new NodeState();
    expect(state.current).toBe("idle");
  });

  it("allows idle → computing", () => {
    const state = new NodeState();
    state.transition("computing");
    expect(state.current).toBe("computing");
  });

  it("allows computing → ready", () => {
    const state = new NodeState("computing");
    state.transition("ready");
    expect(state.current).toBe("ready");
  });

  it("allows computing → error", () => {
    const state = new NodeState("computing");
    state.transition("error");
    expect(state.current).toBe("error");
  });

  it("throws InvalidTransition for computing → idle", () => {
    const state = new NodeState("computing");
    expect(() => state.transition("idle")).toThrow(InvalidTransition);
  });

  it("allows the full happy path: idle → computing → ready → dirty → computing → ready", () => {
    const state = new NodeState();
    state.transition("computing");
    expect(state.current).toBe("computing");
    state.transition("ready");
    expect(state.current).toBe("ready");
    state.transition("dirty");
    expect(state.current).toBe("dirty");
    state.transition("computing");
    expect(state.current).toBe("computing");
    state.transition("ready");
    expect(state.current).toBe("ready");
  });

  it("allows error → computing (retry)", () => {
    const state = new NodeState("error");
    state.transition("computing");
    expect(state.current).toBe("computing");
  });

  it("allows error → idle (reset)", () => {
    const state = new NodeState("error");
    state.transition("idle");
    expect(state.current).toBe("idle");
  });

  it("allows idle → error (parse failure)", () => {
    const state = new NodeState();
    state.transition("error");
    expect(state.current).toBe("error");
  });

  it("throws for ready → computing (must go through dirty)", () => {
    const state = new NodeState("ready");
    expect(() => state.transition("computing")).toThrow(InvalidTransition);
  });
});
