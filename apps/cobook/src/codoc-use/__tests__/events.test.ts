import { describe, it, expect, vi } from "vitest";
import { bridgeWorkspaceEvents } from "../events.js";
import type { Workspace, WorkspaceChangeEvent } from "@codoc/core";
import type { ChatAbility } from "@/chat/index.js";

vi.mock("@codoc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codoc/core")>();
  return {
    ...actual,
    propagateDirty: vi.fn().mockReturnValue(["/downstream"]),
  };
});

function makeWorkspace() {
  let listener: ((event: WorkspaceChangeEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    ws: {
      onFieldChange: vi.fn((cb: (event: WorkspaceChangeEvent) => void) => {
        listener = cb;
        return unsubscribe;
      }),
      loadDoc: vi.fn().mockReturnValue({
        dag: {},
        tree: {},
      }),
    } as unknown as Workspace,
    emit(event: WorkspaceChangeEvent) {
      listener?.(event);
    },
    unsubscribe,
  };
}

function makeChat() {
  return {
    sendMessage: vi.fn(),
  } as unknown as ChatAbility;
}

describe("bridgeWorkspaceEvents", () => {
  it("batches field changes into a single system message", async () => {
    const { ws, emit } = makeWorkspace();
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1", 50);
    emit({ docId: "report.codoc", fieldPath: "/title", timestamp: 1 });
    emit({ docId: "report.codoc", fieldPath: "/body", timestamp: 2 });

    // Not yet flushed
    expect(chat.sendMessage).not.toHaveBeenCalled();

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 80));

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const call = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("s1");
    expect(call[1].content).toContain("/title");
    expect(call[1].content).toContain("/body");
    expect(call[1].content).toContain("/downstream");
    expect(call[1].resourceRefs).toEqual([{ kind: "codoc", id: "report.codoc" }]);
  });

  it("includes downstream stale notifications in the batch", async () => {
    const { ws, emit } = makeWorkspace();
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1", 50);
    emit({ docId: "doc.codoc", fieldPath: "/name", timestamp: 1 });

    await new Promise((r) => setTimeout(r, 80));

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const content = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(content).toContain("/name");
    expect(content).toContain("/downstream");
  });

  it("returns unsubscribe function", () => {
    const { ws, unsubscribe } = makeWorkspace();
    const chat = makeChat();

    const unsub = bridgeWorkspaceEvents(ws, chat, "s1", 50);
    unsub();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("handles loadDoc failure gracefully", async () => {
    const { ws, emit } = makeWorkspace();
    (ws.loadDoc as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("not loaded");
    });
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1", 50);
    emit({ docId: "missing.codoc", fieldPath: "/x", timestamp: 1 });

    await new Promise((r) => setTimeout(r, 80));

    // Only the change message, no downstream (loadDoc threw)
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const content = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(content).toContain("/x");
    expect(content).not.toContain("downstream");
  });

  it("batches events across multiple documents", async () => {
    const { ws, emit } = makeWorkspace();
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1", 50);
    emit({ docId: "a.codoc", fieldPath: "/x", timestamp: 1 });
    emit({ docId: "b.codoc", fieldPath: "/y", timestamp: 2 });

    await new Promise((r) => setTimeout(r, 80));

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const call = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.content).toContain("a.codoc");
    expect(call.content).toContain("b.codoc");
    expect(call.resourceRefs).toHaveLength(2);
  });

  it("deduplicates repeated field changes within a batch", async () => {
    const { ws, emit } = makeWorkspace();
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1", 50);
    emit({ docId: "doc.codoc", fieldPath: "/title", timestamp: 1 });
    emit({ docId: "doc.codoc", fieldPath: "/title", timestamp: 2 });
    emit({ docId: "doc.codoc", fieldPath: "/title", timestamp: 3 });

    await new Promise((r) => setTimeout(r, 80));

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const content = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    // /title should appear only once (deduplicated by Set)
    const titleMatches = content.match(/`\/title`/g);
    expect(titleMatches).toHaveLength(1);
  });
});
