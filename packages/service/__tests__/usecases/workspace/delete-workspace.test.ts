import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { appendUserMessage } from "../../../src/usecases/thread/append-user-message.js";
import { createThread } from "../../../src/usecases/thread/create-thread.js";
import { getThread } from "../../../src/usecases/thread/get-thread.js";
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

  it("cascades: deleting a workspace wipes its threads and messages", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const thread = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: "Chat",
    });
    if (!thread.ok) throw new Error("setup failed");

    const msg = await appendUserMessage(ctx, {
      threadId: thread.value.thread.id,
      content: "hello",
    });
    if (!msg.ok) throw new Error("setup failed");

    const del = await deleteWorkspace(ctx, ws.value.id);
    expect(del.ok).toBe(true);

    // The thread (and its message log) is gone — getThread reports
    // not-found.
    const orphan = await getThread(ctx, thread.value.thread.id);
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) {
      expect(orphan.error.kind).toBe("thread-not-found");
    }
  });
});
