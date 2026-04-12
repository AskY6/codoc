import type { ThreadId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createThread } from "../../../src/usecases/thread/create-thread.js";
import { deleteThread } from "../../../src/usecases/thread/delete-thread.js";
import { listThreadsByWorkspace } from "../../../src/usecases/thread/list-threads-by-workspace.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("deleteThread", () => {
  it("removes a thread so subsequent list calls omit it", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const a = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: "A",
    });
    const b = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: "B",
    });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    const del = await deleteThread(ctx, a.value.thread.id);
    expect(del.ok).toBe(true);

    const list = await listThreadsByWorkspace(ctx, ws.value.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);
    expect(list.value[0]!.thread.id).toBe(b.value.thread.id);
  });

  it("returns thread-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await deleteThread(ctx, "thread_nope" as ThreadId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("thread-not-found");
    }
  });
});
