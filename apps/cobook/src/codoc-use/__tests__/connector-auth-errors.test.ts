import { describe, it, expect, vi, beforeEach } from "vitest";
import { bridgeConnectorAuthErrors } from "../events.js";
import type { Workspace, WorkspaceChangeEvent } from "@codoc/core";
import type { ChatAbility } from "../../chat/index.js";

function createMockWorkspace() {
  const listeners: Array<(e: WorkspaceChangeEvent) => void> = [];
  return {
    onFieldChange: vi.fn((cb: (e: WorkspaceChangeEvent) => void) => {
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    loadDoc: vi.fn(),
    _emit(e: WorkspaceChangeEvent) {
      for (const cb of listeners) cb(e);
    },
  };
}

function createMockChat() {
  return {
    sendMessage: vi.fn(),
  };
}

describe("bridgeConnectorAuthErrors", () => {
  let ws: ReturnType<typeof createMockWorkspace>;
  let chat: ReturnType<typeof createMockChat>;

  beforeEach(() => {
    ws = createMockWorkspace();
    chat = createMockChat();
  });

  it("sends guidance when connector auth error is detected", () => {
    ws.loadDoc.mockReturnValue({
      tree: {
        getField: () => ({
          path: "/tasks",
          meta: {
            loader: {
              type: "source",
              $source: { connector: "feishu-table", appToken: "abc" },
            },
          },
          state: {
            status: "error",
            error: {
              kind: "source",
              message: "飞书认证未配置：缺少 appId 或 appSecret",
              retryable: false,
            },
          },
        }),
      },
    });

    bridgeConnectorAuthErrors(
      ws as unknown as Workspace,
      chat as unknown as ChatAbility,
      "session-1",
    );

    ws._emit({ docId: "project.codoc", fieldPath: "/tasks" });

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const [sessionId, msg] = chat.sendMessage.mock.calls[0];
    expect(sessionId).toBe("session-1");
    expect(msg.content).toContain("feishu-table");
    expect(msg.content).toContain("credentials.yaml");
    expect(msg.resourceRefs).toEqual([{ kind: "codoc", id: "project.codoc" }]);
  });

  it("sends guidance only once per connector", () => {
    ws.loadDoc.mockReturnValue({
      tree: {
        getField: (path: string) => ({
          path,
          meta: {
            loader: {
              type: "source",
              $source: { connector: "feishu-table", appToken: "abc" },
            },
          },
          state: {
            status: "error",
            error: {
              kind: "source",
              message: "飞书认证未配置：缺少 appId 或 appSecret",
              retryable: false,
            },
          },
        }),
      },
    });

    bridgeConnectorAuthErrors(
      ws as unknown as Workspace,
      chat as unknown as ChatAbility,
      "session-1",
    );

    ws._emit({ docId: "a.codoc", fieldPath: "/tasks" });
    ws._emit({ docId: "b.codoc", fieldPath: "/other" });

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send guidance for non-auth errors", () => {
    ws.loadDoc.mockReturnValue({
      tree: {
        getField: () => ({
          path: "/tasks",
          meta: {
            loader: {
              type: "source",
              $source: { connector: "feishu-table", appToken: "abc" },
            },
          },
          state: {
            status: "error",
            error: {
              kind: "source",
              message: "飞书表格请求失败: table not found",
              retryable: false,
            },
          },
        }),
      },
    });

    bridgeConnectorAuthErrors(
      ws as unknown as Workspace,
      chat as unknown as ChatAbility,
      "session-1",
    );

    ws._emit({ docId: "a.codoc", fieldPath: "/tasks" });

    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("does not send guidance for URL source errors", () => {
    ws.loadDoc.mockReturnValue({
      tree: {
        getField: () => ({
          path: "/weather",
          meta: {
            loader: {
              type: "source",
              $source: "https://example.com/api",
            },
          },
          state: {
            status: "error",
            error: {
              kind: "source",
              message: "认证未配置",
              url: "https://example.com/api",
              retryable: false,
            },
          },
        }),
      },
    });

    bridgeConnectorAuthErrors(
      ws as unknown as Workspace,
      chat as unknown as ChatAbility,
      "session-1",
    );

    ws._emit({ docId: "a.codoc", fieldPath: "/weather" });

    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("returns unsubscribe function", () => {
    const unsub = bridgeConnectorAuthErrors(
      ws as unknown as Workspace,
      chat as unknown as ChatAbility,
      "session-1",
    );

    expect(typeof unsub).toBe("function");
    unsub();
    // After unsub, no more listeners
    expect(ws.onFieldChange).toHaveBeenCalledTimes(1);
  });
});
