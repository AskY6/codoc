import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createThread } from "../../../src/usecases/thread/create-thread.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("createThread", () => {
  it("mints a thread id from ctx.idGen and returns a list DTO", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const result = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: "First chat",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.thread.id).toBe("thread_1");
    expect(result.value.thread.workspaceId).toBe(ws.value.id);
    expect(result.value.thread.title).toBe("First chat");
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

    const result = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.thread.title).toBeNull();
    }
  });

  it("returns workspace-not-found when the workspace is missing", async () => {
    const { ctx } = makeTestCtx();

    const result = await createThread(ctx, {
      workspaceId: "ws_nope" as WorkspaceId,
      title: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("workspace-not-found");
    }
  });
});
