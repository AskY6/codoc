import type { ConnectorFn, ConnectorMeta } from "@codoc/core";
import { getTenantToken } from "./auth.js";

interface FeishuDocConfig {
  docToken: string;
  format?: "markdown" | "text" | "blocks";
}

interface FeishuAuth {
  appId: string;
  appSecret: string;
}

export const feishuDocConnector: ConnectorFn = async (rawConfig, rawAuth) => {
  const config = rawConfig as unknown as FeishuDocConfig;
  const auth = rawAuth as FeishuAuth | undefined;

  if (!auth?.appId || !auth?.appSecret) {
    throw {
      kind: "source",
      message: "飞书认证未配置：缺少 appId 或 appSecret",
      retryable: false,
    };
  }

  const token = await getTenantToken(auth.appId, auth.appSecret);
  const format = config.format ?? "markdown";

  if (format === "blocks") {
    return fetchDocBlocks(token, config.docToken);
  }

  return fetchDocRawContent(token, config.docToken, format);
};

async function fetchDocRawContent(
  token: string,
  docToken: string,
  format: "markdown" | "text",
): Promise<string> {
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/raw_content`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    code: number;
    msg: string;
    data?: { content?: string };
  };

  if (data.code !== 0) {
    const retryable = data.code === 99991400 || data.code === 99991672;
    throw {
      kind: "source",
      message: `飞书文档请求失败: ${data.msg}`,
      retryable,
    };
  }

  const content = data.data?.content ?? "";

  if (format === "text") {
    // raw_content is already plain text
    return content;
  }

  // "markdown" — wrap as-is (raw_content is close to markdown)
  return content;
}

async function fetchDocBlocks(
  token: string,
  docToken: string,
): Promise<unknown[]> {
  const blocks: unknown[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);

    const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/blocks?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      code: number;
      msg: string;
      data?: {
        items?: unknown[];
        has_more?: boolean;
        page_token?: string;
      };
    };

    if (data.code !== 0) {
      const retryable = data.code === 99991400 || data.code === 99991672;
      throw {
        kind: "source",
        message: `飞书文档块请求失败: ${data.msg}`,
        retryable,
      };
    }

    for (const item of data.data?.items ?? []) {
      blocks.push(item);
    }

    pageToken = data.data?.has_more ? data.data.page_token : undefined;
  } while (pageToken);

  return blocks;
}

export const feishuDocMeta: ConnectorMeta = {
  name: "feishu-doc",
  displayName: "飞书文档",
  description:
    "从飞书新版文档（Docx）拉取内容。支持 markdown、纯文本、blocks 三种格式。",
  configSchema: {
    type: "object",
    required: ["docToken"],
    properties: {
      docToken: {
        type: "string",
        description: "文档 token（URL 中 /docx/ 后面的部分）",
      },
      format: {
        type: "string",
        enum: ["markdown", "text", "blocks"],
        description: "输出格式，默认 markdown",
      },
    },
  },
  authSchema: {
    type: "object",
    required: ["appId", "appSecret"],
    properties: {
      appId: { type: "string", description: "飞书应用 App ID" },
      appSecret: { type: "string", description: "飞书应用 App Secret" },
    },
  },
  exampleYaml: `meetingNotes:
  $source:
    connector: feishu-doc
    docToken: doccnXXXXXXXXXX
    format: markdown
  ttl: 600
  refresh: lazy`,
};
