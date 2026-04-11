import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createCodoc } from "../../../src/usecases/codoc/create-codoc.js";
import { listCodocsByWorkspace } from "../../../src/usecases/codoc/list-codocs-by-workspace.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("listCodocsByWorkspace", () => {
  it("returns an empty list for a fresh workspace", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const result = await listCodocsByWorkspace(ctx, ws.value.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("returns only codocs belonging to the requested workspace", async () => {
    const { ctx } = makeTestCtx();
    const alpha = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    const beta = await createWorkspace(ctx, {
      name: "Beta",
      description: null,
    });
    if (!alpha.ok || !beta.ok) throw new Error("setup failed");

    await createCodoc(ctx, {
      workspaceId: alpha.value.id,
      path: "a-one.codoc",
      title: "A1",
    });
    await createCodoc(ctx, {
      workspaceId: alpha.value.id,
      path: "a-two.codoc",
      title: "A2",
    });
    await createCodoc(ctx, {
      workspaceId: beta.value.id,
      path: "b-only.codoc",
      title: "B1",
    });

    const result = await listCodocsByWorkspace(ctx, alpha.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);
    const titles = result.value.map((it) => it.title).sort();
    expect(titles).toEqual(["A1", "A2"]);
  });

  it("returns workspace-not-found for an unknown workspace id", async () => {
    const { ctx } = makeTestCtx();

    const result = await listCodocsByWorkspace(
      ctx,
      "ws_nope" as WorkspaceId,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("workspace-not-found");
    }
  });
});
