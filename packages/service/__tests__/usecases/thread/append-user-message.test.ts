import type { ThreadId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { appendUserMessage } from "../../../src/usecases/thread/append-user-message.js";
import { createThread } from "../../../src/usecases/thread/create-thread.js";
import { getThread } from "../../../src/usecases/thread/get-thread.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("appendUserMessage", () => {
  it("mints a message id and returns a user-variant ThreadMessage", async () => {
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

    const result = await appendUserMessage(ctx, {
      threadId: thread.value.thread.id,
      content: "hello",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.message.id).toBe("msg_1");
    expect(result.value.message.kind).toBe("user");
    expect(result.value.message.threadId).toBe(thread.value.thread.id);
    if (result.value.message.kind === "user") {
      expect(result.value.message.content).toBe("hello");
    }
    expect(result.value.seq).toBe(1);
    expect(typeof result.value.createdAt).toBe("number");
  });

  it("assigns monotonic seq per thread", async () => {
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

    const a1 = await appendUserMessage(ctx, {
      threadId: a.value.thread.id,
      content: "a1",
    });
    const a2 = await appendUserMessage(ctx, {
      threadId: a.value.thread.id,
      content: "a2",
    });
    const b1 = await appendUserMessage(ctx, {
      threadId: b.value.thread.id,
      content: "b1",
    });
    if (!a1.ok || !a2.ok || !b1.ok) throw new Error("append failed");

    expect(a1.value.seq).toBe(1);
    expect(a2.value.seq).toBe(2);
    // seq is per-thread, so thread B starts at 1.
    expect(b1.value.seq).toBe(1);
  });

  it("does not bump thread.updatedAt on append", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");
    const created = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: "Chat",
    });
    if (!created.ok) throw new Error("setup failed");
    const originalUpdatedAt = created.value.updatedAt;
    const originalRev = created.value.rev;

    const appended = await appendUserMessage(ctx, {
      threadId: created.value.thread.id,
      content: "hello",
    });
    if (!appended.ok) throw new Error("append failed");

    const after = await getThread(ctx, created.value.thread.id);
    if (!after.ok) throw new Error("get failed");
    expect(after.value.thread.updatedAt).toBe(originalUpdatedAt);
    expect(after.value.thread.rev).toBe(originalRev);
  });

  it("returns thread-not-found when the thread is missing", async () => {
    const { ctx } = makeTestCtx();

    const result = await appendUserMessage(ctx, {
      threadId: "thread_nope" as ThreadId,
      content: "hi",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("thread-not-found");
    }
  });
});
