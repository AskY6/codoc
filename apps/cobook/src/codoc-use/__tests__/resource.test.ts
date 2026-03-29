import { describe, it, expect } from "vitest";
import { listCodocResources } from "../resource.js";
import type { Workspace } from "@codoc/core";

function mockWorkspace(docIds: string[]): Workspace {
  return {
    listDocs: () =>
      docIds.map((docId) => ({
        docId,
        type: {},
        fields: [],
        externalRefs: [],
      })),
  } as unknown as Workspace;
}

describe("listCodocResources", () => {
  it("returns empty array for empty workspace", () => {
    const ws = mockWorkspace([]);
    expect(listCodocResources(ws)).toEqual([]);
  });

  it("maps docs to ResourceRef with kind codoc", () => {
    const ws = mockWorkspace(["report.codoc", "summary.codoc"]);
    const refs = listCodocResources(ws);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      kind: "codoc",
      id: "report.codoc",
      label: "report.codoc",
    });
    expect(refs[1]).toEqual({
      kind: "codoc",
      id: "summary.codoc",
      label: "summary.codoc",
    });
  });
});
