import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { feishuDocConnector, feishuDocMeta } from "../doc.js";
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

describe("feishuDocConnector", () => {
  it("throws when auth is missing", async () => {
    await expect(
      feishuDocConnector({ docToken: "doc123" }, undefined),
    ).rejects.toMatchObject({
      kind: "source",
      message: expect.stringContaining("认证未配置"),
      retryable: false,
    });
  });

  it("fetches raw content in markdown format", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: { content: "# Hello\n\nWorld" },
        }),
    });

    const result = await feishuDocConnector(
      { docToken: "doccnABC123" },
      { appId: "cli_test", appSecret: "secret" },
    );

    expect(result).toBe("# Hello\n\nWorld");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const url = mockFetch.mock.calls[1][0] as string;
    expect(url).toContain("/docx/v1/documents/doccnABC123/raw_content");
  });

  it("fetches text format", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: { content: "plain text content" },
        }),
    });

    const result = await feishuDocConnector(
      { docToken: "doccnABC123", format: "text" },
      { appId: "cli_test", appSecret: "secret" },
    );

    expect(result).toBe("plain text content");
  });

  it("fetches blocks format with pagination", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: {
            items: [{ block_id: "b1", block_type: 1 }],
            has_more: true,
            page_token: "pt1",
          },
        }),
    });
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 0,
          data: {
            items: [{ block_id: "b2", block_type: 2 }],
            has_more: false,
          },
        }),
    });

    const result = await feishuDocConnector(
      { docToken: "doccnABC123", format: "blocks" },
      { appId: "cli_test", appSecret: "secret" },
    );

    expect(result).toEqual([
      { block_id: "b1", block_type: 1 },
      { block_id: "b2", block_type: 2 },
    ]);
  });

  it("throws on API error", async () => {
    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 40003,
          msg: "document not found",
        }),
    });

    await expect(
      feishuDocConnector(
        { docToken: "doccnBAD" },
        { appId: "cli_test", appSecret: "secret" },
      ),
    ).rejects.toMatchObject({
      kind: "source",
      message: expect.stringContaining("document not found"),
    });
  });
});

describe("feishuDocMeta", () => {
  it("has required fields", () => {
    expect(feishuDocMeta.name).toBe("feishu-doc");
    expect(feishuDocMeta.displayName).toBe("飞书文档");
    expect(feishuDocMeta.exampleYaml).toContain("feishu-doc");
    expect(feishuDocMeta.configSchema).toBeDefined();
    expect(feishuDocMeta.authSchema).toBeDefined();
  });
});
