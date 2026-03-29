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
  it("sends system message on field change", () => {
    const { ws, emit } = makeWorkspace();
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1");
    emit({ docId: "report.codoc", fieldPath: "/title", timestamp: 1 });

    expect(chat.sendMessage).toHaveBeenCalledWith("s1", {
      sender: { id: "system", kind: "agent" },
      content: "codoc **report.codoc** field `/title` changed.",
      resourceRefs: [{ kind: "codoc", id: "report.codoc" }],
    });
  });

  it("sends downstream stale notifications", () => {
    const { ws, emit } = makeWorkspace();
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1");
    emit({ docId: "doc.codoc", fieldPath: "/name", timestamp: 1 });

    // First call: the change itself, second: the downstream stale
    expect(chat.sendMessage).toHaveBeenCalledTimes(2);
    expect(chat.sendMessage).toHaveBeenCalledWith("s1", expect.objectContaining({
      content: expect.stringContaining("/downstream"),
    }));
  });

  it("returns unsubscribe function", () => {
    const { ws, unsubscribe } = makeWorkspace();
    const chat = makeChat();

    const unsub = bridgeWorkspaceEvents(ws, chat, "s1");
    unsub();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("handles loadDoc failure gracefully", () => {
    const { ws, emit } = makeWorkspace();
    (ws.loadDoc as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("not loaded");
    });
    const chat = makeChat();

    bridgeWorkspaceEvents(ws, chat, "s1");
    emit({ docId: "missing.codoc", fieldPath: "/x", timestamp: 1 });

    // Only the change message, no downstream (loadDoc threw)
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
  });
});
