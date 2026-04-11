import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { deleteWorkspace } from "../../../src/usecases/workspace/delete-workspace.js";
import { listWorkspaces } from "../../../src/usecases/workspace/list-workspaces.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("deleteWorkspace", () => {
  it("removes an existing workspace", async () => {
    const { ctx } = makeTestCtx();
    const created = await createWorkspace(ctx, {
      name: "ToDelete",
      description: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteWorkspace(ctx, created.value.id);
    expect(result.ok).toBe(true);

    const list = await listWorkspaces(ctx);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toEqual([]);
    }
  });

  it("returns workspace-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await deleteWorkspace(ctx, "ws_nonexistent" as WorkspaceId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("workspace-not-found");
    }
  });
});
