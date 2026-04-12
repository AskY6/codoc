import { describe, expect, it } from "vitest";
import { mergeState } from "../src/graph/state.js";
import type { StateReducers } from "../src/graph/state.js";

interface TestState {
  count: number;
  items: readonly string[];
  label: string;
}

describe("mergeState", () => {
  it("applies last-write-wins for fields without reducers", () => {
    const prev: TestState = { count: 1, items: ["a"], label: "old" };
    const result = mergeState(prev, { label: "new" }, {});
    expect(result.label).toBe("new");
    expect(result.count).toBe(1);
    expect(result.items).toEqual(["a"]);
  });

  it("uses reducer when present", () => {
    const reducers: StateReducers<TestState> = {
      items: (prev, incoming) => [...prev, ...incoming],
    };
    const prev: TestState = { count: 0, items: ["a"], label: "" };
    const result = mergeState(prev, { items: ["b", "c"] }, reducers);
    expect(result.items).toEqual(["a", "b", "c"]);
  });

  it("skips undefined values in the update", () => {
    const prev: TestState = { count: 5, items: [], label: "keep" };
    const result = mergeState(prev, { count: undefined } as unknown as Partial<TestState>, {});
    expect(result.count).toBe(5);
  });

  it("can apply multiple fields at once", () => {
    const reducers: StateReducers<TestState> = {
      items: (prev, incoming) => [...prev, ...incoming],
    };
    const prev: TestState = { count: 0, items: ["a"], label: "old" };
    const result = mergeState(
      prev,
      { count: 10, items: ["b"], label: "new" },
      reducers,
    );
    expect(result.count).toBe(10);
    expect(result.items).toEqual(["a", "b"]);
    expect(result.label).toBe("new");
  });

  it("returns an identical copy when update is empty", () => {
    const prev: TestState = { count: 1, items: ["a"], label: "x" };
    const result = mergeState(prev, {}, {});
    expect(result).toEqual(prev);
  });
});
