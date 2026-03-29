import { describe, it, expect, vi } from "vitest";
import { executeCodocIntent } from "../intent.js";
import type { Workspace } from "@codoc/core";
import type { Intent } from "../../chat/types.js";

function makeTree() {
  return {
    updateField: vi.fn(),
    refreshField: vi.fn(),
    observe: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDag() {
  return {};
}

vi.mock("@codoc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codoc/core")>();
  return {
    ...actual,
    propagateAndInvalidate: vi.fn().mockReturnValue(["/downstream"]),
  };
});

describe("executeCodocIntent", () => {
  it("executes write-codoc-field intent", async () => {
    const tree = makeTree();
    const dag = makeDag();
    const ws = {
      loadDoc: vi.fn().mockReturnValue({ tree, dag }),
    } as unknown as Workspace;

    const intent: Intent = {
      kind: "write-codoc-field",
      payload: { docId: "doc.codoc", field: "/name", value: "New Name" },
      status: "confirmed",
    };

    await executeCodocIntent(ws, intent);
    expect(ws.loadDoc).toHaveBeenCalledWith("doc.codoc");
    expect(tree.updateField).toHaveBeenCalledWith("/name", "New Name");
    // Downstream propagation triggers observe
    expect(tree.observe).toHaveBeenCalledWith("/downstream");
  });

  it("executes force-codoc-field intent", async () => {
    const tree = makeTree();
    const ws = {
      loadDoc: vi.fn().mockReturnValue({ tree, dag: makeDag() }),
    } as unknown as Workspace;

    const intent: Intent = {
      kind: "force-codoc-field",
      payload: { docId: "doc.codoc", field: "/body" },
      status: "confirmed",
    };

    await executeCodocIntent(ws, intent);
    expect(tree.refreshField).toHaveBeenCalledWith("/body");
    expect(tree.observe).toHaveBeenCalledWith("/body");
  });

  it("no-ops for create-codoc and delete-codoc (not yet implemented)", async () => {
    const ws = {} as unknown as Workspace;
    await executeCodocIntent(ws, {
      kind: "create-codoc",
      payload: { docId: "new.codoc", content: "" },
      status: "confirmed",
    });
    await executeCodocIntent(ws, {
      kind: "delete-codoc",
      payload: { docId: "old.codoc" },
      status: "confirmed",
    });
    // Should not throw
  });
});
