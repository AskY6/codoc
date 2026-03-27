import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { externalLoader } from "../loader/external.js";
import { DocRegistry, setDocRegistry, getDocRegistry } from "../doc-registry.js";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import type { CodataField, ForceContext } from "../types.js";

function makeDoc(data: Record<string, unknown>) {
  const type: Record<string, unknown> = { properties: {} };
  for (const key of Object.keys(data)) {
    (type.properties as Record<string, unknown>)[key] = { type: "string" };
  }
  const tree = new DataTree({ type, data });
  const dag = DAG.buildFromTree(tree);
  return { tree, dag };
}

function makeExternalField(
  path: string,
  docRef: string,
  fieldPath: string,
): CodataField {
  return {
    path,
    meta: {
      loader: { type: "external", docRef, fieldPath },
    },
    state: { status: "idle" },
  };
}

const dummyContext: ForceContext = {
  force: async () => undefined,
  forceStack: new Set(),
};

describe("externalLoader", () => {
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

  it("resolves a field from another document", async () => {
    const b = makeDoc({ title: "Hello from B" });
    registry.register("B.codoc", b.tree, b.dag);

    const field = makeExternalField("/ref_b", "B.codoc", "/title");
    const value = await externalLoader(field, dummyContext);
    expect(value).toBe("Hello from B");
  });

  it("throws external_ref error when doc not found", async () => {
    const field = makeExternalField("/ref_x", "X.codoc", "/title");
    try {
      await externalLoader(field, dummyContext);
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const e = err as { kind: string; docRef: string };
      expect(e.kind).toBe("external_ref");
      expect(e.docRef).toBe("X.codoc");
    }
  });

  it("throws external_ref error when field not found in target doc", async () => {
    const b = makeDoc({ title: "Hello" });
    registry.register("B.codoc", b.tree, b.dag);

    const field = makeExternalField("/ref_b", "B.codoc", "/missing");
    try {
      await externalLoader(field, dummyContext);
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const e = err as { kind: string; fieldPath: string };
      expect(e.kind).toBe("external_ref");
      expect(e.fieldPath).toBe("/missing");
    }
  });

  it("throws when no DocRegistry is set", async () => {
    setDocRegistry(null as unknown as DocRegistry);
    const field = makeExternalField("/ref_b", "B.codoc", "/title");
    try {
      await externalLoader(field, dummyContext);
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const e = err as { kind: string };
      expect(e.kind).toBe("external_ref");
    }
  });
});
