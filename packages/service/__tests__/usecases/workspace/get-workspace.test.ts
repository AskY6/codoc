import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createCodoc } from "../../../src/usecases/codoc/create-codoc.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { getWorkspace } from "../../../src/usecases/workspace/get-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("getWorkspace", () => {
  it("returns a UI envelope with rev, updatedAt, and codocCount", async () => {
    const { ctx } = makeTestCtx();
    const created = await createWorkspace(ctx, {
      name: "Alpha",
      description: "first",
    });
    if (!created.ok) throw new Error("setup failed");

    await createCodoc(ctx, {
      workspaceId: created.value.id,
      path: "one.codoc",
      title: "one",
    });
    await createCodoc(ctx, {
      workspaceId: created.value.id,
      path: "two.codoc",
      title: "two",
    });

    const result = await getWorkspace(ctx, created.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.workspace.id).toBe(created.value.id);
    expect(result.value.workspace.name).toBe("Alpha");
    expect(result.value.workspace.description).toBe("first");
    expect(typeof result.value.rev).toBe("string");
    expect(typeof result.value.updatedAt).toBe("number");
    expect(result.value.codocCount).toBe(2);
  });

  it("returns workspace-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await getWorkspace(ctx, "ws_nope" as WorkspaceId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("workspace-not-found");
    }
  });
});
