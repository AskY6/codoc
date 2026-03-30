import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { feishuBotConnector, feishuBotMeta } from "../bot.js";
import { clearTokenCache } from "../auth.js";

const mockFetch = vi.fn();

beforeEach(() => {
  clearTokenCache();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockTokenResponse() {
  mockFetch.mockResolvedValueOnce({
    json: () =>
      Promise.resolve({
        code: 0,
        tenant_access_token: "test-token",
        expire: 7200,
      }),
  });
}

const sampleMessages = [
  {
    message_id: "m1",
    msg_type: "text",
    body: { content: '{"text":"hello world"}' },
    sender: {
      sender_id: { open_id: "ou_user1" },
      sender_type: "user",
      tenant_key: "tk1",
    },
    create_time: String(Math.floor(Date.now() / 1000)),
  },
  {
    message_id: "m2",
    msg_type: "post",
    body: {
      content: JSON.stringify({
        title: "Weekly Update",
        content: [[{ tag: "text", text: "line one" }], [{ tag: "text", text: "line two" }]],
      }),
    },
    sender: {
      sender_id: { open_id: "ou_user2" },
      sender_type: "user",
      tenant_key: "tk1",
    },
    create_time: String(Math.floor(Date.now() / 1000)),
  },
  {
    message_id: "m3",
    msg_type: "image",
    body: { content: '{"image_key":"img_xxx"}' },
    sender: {
      sender_id: { open_id: "ou_user3" },
      sender_type: "user",
      tenant_key: "tk1",
    },
    create_time: String(Math.floor(Date.now() / 1000)),
  },
];

describe("feishuBotConnector", () => {
  it("throws when auth is missing", async () => {
    await expect(
      feishuBotConnector({ chatId: "oc_test" }, undefined),
    ).rejects.toMatchObject({
      kind: "source",
      message: expect.stringContaining("认证未配置"),
      retryable: false,
    });
  });

  it("fetches and normalizes messages", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: { items: sampleMessages, has_more: false },
        }),
    });

    const result = (await feishuBotConnector(
      { chatId: "oc_test123" },
      { appId: "cli_test", appSecret: "secret" },
    )) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      messageId: "m1",
      content: "hello world",
      type: "text",
    });
    // Post messages extract text content
    expect(result[1]).toMatchObject({
      messageId: "m2",
      content: "Weekly Update\nline one\nline two",
      type: "post",
    });
  });

  it("filters by messageTypes", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: { items: sampleMessages, has_more: false },
        }),
    });

    const result = (await feishuBotConnector(
      { chatId: "oc_test123", messageTypes: ["text"] },
      { appId: "cli_test", appSecret: "secret" },
    )) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("respects maxMessages", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: { items: sampleMessages, has_more: true, page_token: "pt1" },
        }),
    });

    const result = (await feishuBotConnector(
      { chatId: "oc_test123", maxMessages: 2 },
      { appId: "cli_test", appSecret: "secret" },
    )) as Array<Record<string, unknown>>;

    // Should stop at 2 even though has_more is true
    expect(result).toHaveLength(2);
    // No second fetch call (only token + first page)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on API error", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 230001,
          msg: "chat not found",
        }),
    });

    await expect(
      feishuBotConnector(
        { chatId: "oc_bad" },
        { appId: "cli_test", appSecret: "secret" },
      ),
    ).rejects.toMatchObject({
      kind: "source",
      message: expect.stringContaining("chat not found"),
    });
  });
});

describe("feishuBotMeta", () => {
  it("has required fields", () => {
    expect(feishuBotMeta.name).toBe("feishu-bot");
    expect(feishuBotMeta.displayName).toBe("飞书群消息");
    expect(feishuBotMeta.exampleYaml).toContain("feishu-bot");
    expect(feishuBotMeta.configSchema).toBeDefined();
    expect(feishuBotMeta.authSchema).toBeDefined();
  });
});
