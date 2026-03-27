import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import {
  DocRegistry,
  setDocRegistry,
  getDocRegistry,
} from "../doc-registry.js";
import {
  wireExternalDeps,
  crossDocPropagate,
  buildDocDAG,
  detectDocCycle,
} from "../cross-doc-propagator.js";
import { propagateAndInvalidate } from "../dirty-propagator.js";
import { extractExternalDeps } from "../dep-extractor.js";

function makeDoc(data: Record<string, unknown>) {
  const type: Record<string, unknown> = { properties: {} };
  for (const key of Object.keys(data)) {
    (type.properties as Record<string, unknown>)[key] = { type: "string" };
  }
  const tree = new DataTree({ type, data });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

describe("M4 Integration: Cross-Document References", () => {
  let registry: DocRegistry;
  let savedRegistry: ReturnType<typeof getDocRegistry>;

  beforeEach(() => {
    savedRegistry = getDocRegistry();
    registry = new DocRegistry();
    setDocRegistry(registry);
  });

  afterEach(() => {
    if (savedRegistry) {
      setDocRegistry(savedRegistry);
    }
  });

  it("A.codoc resolves a field from B.codoc via external $ref", async () => {
    // B has a title field
    const b = makeDoc({ title: "Hello from B" });
    registry.register("B.codoc", b.tree, b.dag);

    // A references B's title
    const a = makeDoc({
      local: "Local value",
      fromB: { $ref: "[[B.codoc]]/title" },
    });
    registry.register("A.codoc", a.tree, a.dag);

    // Force A's fields
    const localValue = await a.tree.observe("/local");
    expect(localValue).toBe("Local value");

    const fromBValue = await a.tree.observe("/fromB");
    expect(fromBValue).toBe("Hello from B");
  });

  it("extractExternalDeps identifies cross-doc dependencies", () => {
    const a = makeDoc({
      local: "Local",
      fromB: { $ref: "[[B.codoc]]/title" },
      fromC: { $ref: "[[C.codoc]]/count" },
    });
    registry.register("A.codoc", a.tree, a.dag);

    const deps = extractExternalDeps(a.tree);
    expect(deps).toHaveLength(2);
    expect(deps).toContainEqual({
      localPath: "/fromB",
      docRef: "B.codoc",
      fieldPath: "/title",
    });
    expect(deps).toContainEqual({
      localPath: "/fromC",
      docRef: "C.codoc",
      fieldPath: "/count",
    });
  });

  it("external refs don't create intra-doc DAG edges", () => {
    const a = makeDoc({
      local: "Local",
      fromB: { $ref: "[[B.codoc]]/title" },
    });

    // The intra-doc DAG should only have nodes, no edges
    // (external refs are not intra-doc deps)
    const dag = DAG.buildFromTree(a.tree);
    expect(dag.getDirectDeps("/fromB")).toEqual([]);
  });

  it("cross-doc propagation: B changes → A's external ref re-forces", async () => {
    const b = makeDoc({ title: "Original B Title" });
    registry.register("B.codoc", b.tree, b.dag);

    const a = makeDoc({ fromB: { $ref: "[[B.codoc]]/title" } });
    registry.register("A.codoc", a.tree, a.dag);

    // Wire up cross-doc subscriptions
    wireExternalDeps(registry, "A.codoc");

    // Initial force of A
    const initial = await a.tree.observe("/fromB");
    expect(initial).toBe("Original B Title");

    // Update B's title
    b.tree.updateField("/title", "Updated B Title");

    // Wait a tick for async propagation
    await new Promise((r) => setTimeout(r, 50));

    // A's /fromB should be re-evaluated
    const updated = await a.tree.observe("/fromB");
    expect(updated).toBe("Updated B Title");
  });

  it("manual crossDocPropagate works", async () => {
    const b = makeDoc({ title: "B Title" });
    registry.register("B.codoc", b.tree, b.dag);

    const a = makeDoc({ fromB: { $ref: "[[B.codoc]]/title" } });
    registry.register("A.codoc", a.tree, a.dag);

    // Wire up and initial force
    wireExternalDeps(registry, "A.codoc");
    await a.tree.observe("/fromB");

    // Update B
    b.tree.updateField("/title", "New B Title");

    // Manually propagate
    await crossDocPropagate(registry, "B.codoc", ["/title"]);

    const value = await a.tree.observe("/fromB");
    expect(value).toBe("New B Title");
  });

  it("error: referenced document not found", async () => {
    const a = makeDoc({ fromX: { $ref: "[[X.codoc]]/title" } });
    registry.register("A.codoc", a.tree, a.dag);

    try {
      await a.tree.observe("/fromX");
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const e = err as { kind: string; docRef: string };
      expect(e.kind).toBe("external_ref");
      expect(e.docRef).toBe("X.codoc");
    }
  });

  it("error: field not found in referenced document", async () => {
    const b = makeDoc({ title: "B" });
    registry.register("B.codoc", b.tree, b.dag);

    const a = makeDoc({ fromB: { $ref: "[[B.codoc]]/missing" } });
    registry.register("A.codoc", a.tree, a.dag);

    try {
      await a.tree.observe("/fromB");
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const e = err as { kind: string; fieldPath: string };
      expect(e.kind).toBe("external_ref");
      expect(e.fieldPath).toBe("/missing");
    }
  });

  it("detects cyclic cross-document references", () => {
    const a = makeDoc({ fromB: { $ref: "[[B.codoc]]/fromA" } });
    const b = makeDoc({ fromA: { $ref: "[[A.codoc]]/fromB" } });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);

    const cycle = detectDocCycle(registry);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
  });

  it("doc-level DAG reflects cross-doc dependencies", () => {
    const a = makeDoc({ fromB: { $ref: "[[B.codoc]]/title" } });
    const b = makeDoc({ fromC: { $ref: "[[C.codoc]]/value" } });
    const c = makeDoc({ title: "C", value: "42" });

    registry.register("A.codoc", a.tree, a.dag);
    registry.register("B.codoc", b.tree, b.dag);
    registry.register("C.codoc", c.tree, c.dag);

    const { nodes, edges } = buildDocDAG(registry);
    expect(nodes.sort()).toEqual(["A.codoc", "B.codoc", "C.codoc"]);
    expect(edges).toContainEqual({ from: "A.codoc", to: "B.codoc" });
    expect(edges).toContainEqual({ from: "B.codoc", to: "C.codoc" });
    expect(edges).toHaveLength(2);
  });

  it("chain: A → B → C propagation", async () => {
    // C is the source, B refs C, A refs B
    const c = makeDoc({ value: "C original" });
    registry.register("C.codoc", c.tree, c.dag);

    const b = makeDoc({ fromC: { $ref: "[[C.codoc]]/value" } });
    registry.register("B.codoc", b.tree, b.dag);

    const a = makeDoc({ fromB: { $ref: "[[B.codoc]]/fromC" } });
    registry.register("A.codoc", a.tree, a.dag);

    // Wire up subscriptions
    wireExternalDeps(registry, "B.codoc");
    wireExternalDeps(registry, "A.codoc");

    // Initial force chain
    await c.tree.observe("/value");
    await b.tree.observe("/fromC");
    const initialA = await a.tree.observe("/fromB");
    expect(initialA).toBe("C original");

    // Update C
    c.tree.updateField("/value", "C updated");

    // Wait for async propagation through the chain
    await new Promise((r) => setTimeout(r, 100));

    const updatedB = await b.tree.observe("/fromC");
    expect(updatedB).toBe("C updated");

    const updatedA = await a.tree.observe("/fromB");
    expect(updatedA).toBe("C updated");
  });
});
