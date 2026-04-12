import type { ThreadId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { appendUserMessage } from "../../../src/usecases/thread/append-user-message.js";
import { createThread } from "../../../src/usecases/thread/create-thread.js";
import { getThread } from "../../../src/usecases/thread/get-thread.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("getThread", () => {
  it("returns the page bundle DTO with thread envelope and messages", async () => {
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

    const m1 = await appendUserMessage(ctx, {
      threadId: created.value.thread.id,
      content: "hello",
    });
    const m2 = await appendUserMessage(ctx, {
      threadId: created.value.thread.id,
      content: "world",
    });
    if (!m1.ok || !m2.ok) throw new Error("setup failed");

    const result = await getThread(ctx, created.value.thread.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.thread.thread.id).toBe(created.value.thread.id);
    expect(result.value.thread.thread.title).toBe("Chat");
    expect(result.value.messages).toHaveLength(2);
    const contents = result.value.messages.map((m) =>
      m.message.kind === "user" ? m.message.content : null,
    );
    expect(contents).toEqual(["hello", "world"]);
  });

  it("returns an empty message list for a thread with no messages", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!ws.ok) throw new Error("setup failed");

    const created = await createThread(ctx, {
      workspaceId: ws.value.id,
      title: null,
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await getThread(ctx, created.value.thread.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages).toEqual([]);
  });

  it("returns thread-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await getThread(ctx, "thread_nope" as ThreadId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("thread-not-found");
    }
  });
});
