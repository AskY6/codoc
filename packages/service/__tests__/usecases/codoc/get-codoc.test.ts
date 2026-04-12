import type { CodocId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createCodoc } from "../../../src/usecases/codoc/create-codoc.js";
import { getCodoc } from "../../../src/usecases/codoc/get-codoc.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("getCodoc", () => {
  it("returns the detail DTO with content for an existing codoc", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, { name: "Alpha", description: null });
    if (!ws.ok) throw new Error("setup failed");

    const created = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "notes/meeting.codoc",
      title: "Meeting",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await getCodoc(ctx, created.value.id as CodocId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe(created.value.id);
    expect(result.value.path).toBe("notes/meeting.codoc");
    expect(result.value.title).toBe("Meeting");
    // Fresh codocs start with empty content (see create-codoc).
    expect(result.value.content).toBe("");
    expect(result.value.rev).toBe(created.value.rev);
    expect(result.value.updatedAt).toBe(created.value.updatedAt);
  });

  it("returns codoc-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();
    const result = await getCodoc(ctx, "codoc_nope" as CodocId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("codoc-not-found");
    }
  });
});
