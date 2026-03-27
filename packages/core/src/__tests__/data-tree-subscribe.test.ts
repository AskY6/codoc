import { describe, it, expect, vi } from "vitest";
import { DataTree } from "../data-tree.js";

const definition = {
  type: {
    properties: {
      title: { type: "string" },
      count: { type: "number" },
      summary: { type: "string" },
    },
  },
  data: {
    title: "Hello",
    count: 42,
    summary: { $ref: "/title" },
  },
};

describe("DataTree.subscribe", () => {
  it("notifies global listeners on field resolve", async () => {
    const tree = new DataTree(definition);
    const listener = vi.fn();
    tree.subscribe(listener);

    await tree.observe("/title");
    expect(listener).toHaveBeenCalled();
  });

  it("returns an unsubscribe function", async () => {
    const tree = new DataTree(definition);
    const listener = vi.fn();
    const unsub = tree.subscribe(listener);
    unsub();

    await tree.observe("/title");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("DataTree.subscribeField", () => {
  it("notifies field-specific listeners", async () => {
    const tree = new DataTree(definition);
    const titleListener = vi.fn();
    const countListener = vi.fn();

    tree.subscribeField("/title", titleListener);
    tree.subscribeField("/count", countListener);

    await tree.observe("/title");

    expect(titleListener).toHaveBeenCalled();
    expect(countListener).not.toHaveBeenCalled();
  });

  it("unsubscribes correctly", async () => {
    const tree = new DataTree(definition);
    const listener = vi.fn();
    const unsub = tree.subscribeField("/title", listener);
    unsub();

    await tree.observe("/title");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("DataTree.updateField", () => {
  it("updates a field value and notifies", async () => {
    const tree = new DataTree(definition);
    await tree.observe("/title");

    const listener = vi.fn();
    tree.subscribeField("/title", listener);

    tree.updateField("/title", "New Title");

    const field = tree.getField("/title");
    expect(field?.state).toEqual({ status: "resolved", value: "New Title" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("throws on unknown path", () => {
    const tree = new DataTree(definition);
    expect(() => tree.updateField("/nonexistent", "x")).toThrow("Field not found");
  });

  it("updated field can be re-observed by dependents", async () => {
    const tree = new DataTree(definition);
    // First observe summary (which refs /title)
    await tree.observe("/summary");
    expect(tree.getField("/summary")?.state).toEqual({
      status: "resolved",
      value: "Hello",
    });

    // Update title
    tree.updateField("/title", "Updated");

    // Invalidate summary (simulating dirty propagation)
    tree.invalidateField("/summary");

    // Re-observe summary
    const newValue = await tree.observe("/summary");
    expect(newValue).toBe("Updated");
  });
});

describe("DataTree.invalidateField notifies", () => {
  it("notifies subscribers when a field is invalidated", async () => {
    const tree = new DataTree(definition);
    await tree.observe("/title");

    const listener = vi.fn();
    tree.subscribeField("/title", listener);

    tree.invalidateField("/title");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tree.getField("/title")?.state).toEqual({ status: "dirty" });
  });
});

describe("DataTree pending force dedup", () => {
  it("returns the same promise for concurrent observes of the same field", async () => {
    const tree = new DataTree(definition);
    const p1 = tree.observe("/title");
    const p2 = tree.observe("/title");

    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toBe("Hello");
    expect(v2).toBe("Hello");
  });
});
