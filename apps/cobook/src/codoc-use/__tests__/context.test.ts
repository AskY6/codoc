import { describe, it, expect } from "vitest";
import {
  serializeCodocForLLM,
  createCodocContextSource,
  createCodocContextSourceFactory,
} from "../context.js";
import type { DocMeta, CodocRuntime, Workspace } from "@codoc/core";

function makeMeta(docId: string, fieldPaths: string[]): DocMeta {
  return {
    docId,
    type: { type: "object", properties: { name: { type: "string" } } },
    fields: fieldPaths.map((path) => ({
      path,
      loaderType: "literal" as const,
    })),
    externalRefs: [],
  };
}

function makeRuntime(
  fields: Record<string, { status: string; value?: unknown }>,
): CodocRuntime {
  return {
    tree: {
      getField(path: string) {
        const entry = fields[path];
        if (!entry) return undefined;
        return { path, meta: {}, state: entry };
      },
    },
    dag: {},
  } as unknown as CodocRuntime;
}

describe("serializeCodocForLLM", () => {
  it("serializes resolved fields with values", () => {
    const meta = makeMeta("report.codoc", ["/name", "/status"]);
    const runtime = makeRuntime({
      "/name": { status: "resolved", value: "My Report" },
      "/status": { status: "resolved", value: "draft" },
    });

    const result = serializeCodocForLLM(meta, runtime);
    expect(result).toContain("## report.codoc");
    expect(result).toContain("Schema:");
    expect(result).toContain('"name"');
    expect(result).toContain('`/name`: "My Report"');
    expect(result).toContain('`/status`: "draft"');
  });

  it("shows status for non-resolved fields", () => {
    const meta = makeMeta("doc.codoc", ["/title", "/body"]);
    const runtime = makeRuntime({
      "/title": { status: "resolved", value: "Hello" },
      "/body": { status: "pending" },
    });

    const result = serializeCodocForLLM(meta, runtime);
    expect(result).toContain('`/title`: "Hello"');
    expect(result).toContain("`/body`: (pending)");
  });

  it("skips fields not found in runtime", () => {
    const meta = makeMeta("doc.codoc", ["/exists", "/missing"]);
    const runtime = makeRuntime({
      "/exists": { status: "resolved", value: 42 },
    });

    const result = serializeCodocForLLM(meta, runtime);
    expect(result).toContain("`/exists`: 42");
    expect(result).not.toContain("/missing");
  });
});

describe("createCodocContextSource", () => {
  it("resolves to serialized codoc snapshot", async () => {
    const ws = {
      getDocMeta: () => makeMeta("doc.codoc", ["/name"]),
      loadDoc: () =>
        makeRuntime({ "/name": { status: "resolved", value: "Test" } }),
    } as unknown as Workspace;

    const source = createCodocContextSource(ws, "doc.codoc");
    expect(source.kind).toBe("codoc-snapshot");

    const data = await source.resolve();
    expect(data.kind).toBe("codoc-snapshot");
    expect(data.content).toContain("## doc.codoc");
    expect(data.content).toContain('"Test"');
  });

  it("returns not-found message for missing doc", async () => {
    const ws = {
      getDocMeta: () => undefined,
    } as unknown as Workspace;

    const source = createCodocContextSource(ws, "missing.codoc");
    const data = await source.resolve();
    expect(data.content).toContain("not found");
  });
});

describe("createCodocContextSourceFactory", () => {
  it("creates sources keyed by resource ref id", async () => {
    const ws = {
      getDocMeta: (id: string) => makeMeta(id, ["/x"]),
      loadDoc: () =>
        makeRuntime({ "/x": { status: "resolved", value: 1 } }),
    } as unknown as Workspace;

    const factory = createCodocContextSourceFactory(ws);
    expect(factory.kind).toBe("codoc-snapshot");

    const source = factory.create({ kind: "codoc", id: "a.codoc" });
    const data = await source.resolve();
    expect(data.content).toContain("## a.codoc");
  });
});
