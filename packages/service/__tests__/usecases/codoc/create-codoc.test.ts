import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createCodoc } from "../../../src/usecases/codoc/create-codoc.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("createCodoc", () => {
  it("mints a codoc id from ctx.idGen and returns a list DTO", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const result = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "notes/meeting.codoc",
      title: "Meeting",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe("codoc_1");
    expect(result.value.path).toBe("notes/meeting.codoc");
    expect(result.value.title).toBe("Meeting");
    expect(typeof result.value.rev).toBe("string");
    expect(typeof result.value.updatedAt).toBe("number");
  });

  it("accepts a null title", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const result = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "blank.codoc",
      title: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBeNull();
    }
  });

  it("returns workspace-not-found when the workspace is missing", async () => {
    const { ctx } = makeTestCtx();

    const result = await createCodoc(ctx, {
      workspaceId: "ws_nope" as WorkspaceId,
      path: "x.codoc",
      title: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("workspace-not-found");
    }
  });
});
