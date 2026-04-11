import type { CodocId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createCodoc } from "../../../src/usecases/codoc/create-codoc.js";
import { deleteCodoc } from "../../../src/usecases/codoc/delete-codoc.js";
import { listCodocsByWorkspace } from "../../../src/usecases/codoc/list-codocs-by-workspace.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { deleteWorkspace } from "../../../src/usecases/workspace/delete-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("deleteCodoc", () => {
  it("removes a codoc so subsequent list calls omit it", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const a = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "a.codoc",
      title: "A",
    });
    const b = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "b.codoc",
      title: "B",
    });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    const del = await deleteCodoc(ctx, a.value.id as CodocId);
    expect(del.ok).toBe(true);

    const list = await listCodocsByWorkspace(ctx, ws.value.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);
    expect(list.value[0]!.id).toBe(b.value.id);
  });

  it("returns codoc-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await deleteCodoc(ctx, "codoc_nope" as CodocId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("codoc-not-found");
    }
  });

  it("cascades: deleting a workspace wipes its codocs", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const a = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "a.codoc",
      title: "A",
    });
    if (!a.ok) throw new Error("setup failed");

    const del = await deleteWorkspace(ctx, ws.value.id);
    expect(del.ok).toBe(true);

    // The codoc is gone — individual delete now reports not-found.
    const orphan = await deleteCodoc(ctx, a.value.id as CodocId);
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) {
      expect(orphan.error.kind).toBe("codoc-not-found");
    }
  });
});
