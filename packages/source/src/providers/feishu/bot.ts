import type { ConnectorFn, ConnectorMeta } from "../../connector-types.js";
import { getTenantToken } from "./auth.js";

interface FeishuBotConfig {
  chatId: string;
  since?: string;
  messageTypes?: string[];
  maxMessages?: number;
}

interface FeishuAuth {
  appId: string;
  appSecret: string;
}

interface NormalizedMessage {
  messageId: string;
  sender: string;
  senderId: string;
  type: string;
  content: string;
  createTime: string;
}

export const feishuBotConnector: ConnectorFn = async (rawConfig, rawAuth) => {
  const config = rawConfig as unknown as FeishuBotConfig;
  const auth = rawAuth as FeishuAuth | undefined;

  if (!auth?.appId || !auth?.appSecret) {
    throw {
      kind: "source",
      message: "飞书认证未配置：缺少 appId 或 appSecret",
      retryable: false,
    };
  }

  const token = await getTenantToken(auth.appId, auth.appSecret);
  const messages = await fetchMessages(token, config);
  return normalizeMessages(messages, config.messageTypes);
};

function parseSince(since: string): number {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] ?? 60 * 60 * 1000);
}

interface RawMessage {
  message_id: string;
  msg_type: string;
  body: { content: string };
  sender: { sender_id: { open_id: string }; sender_type: string; tenant_key: string };
  create_time: string;
}

async function fetchMessages(
  token: string,
  config: FeishuBotConfig,
): Promise<RawMessage[]> {
  const messages: RawMessage[] = [];
  let pageToken: string | undefined;
  const maxMessages = config.maxMessages ?? 50;
  const sinceMs = parseSince(config.since ?? "24h");
  const startTime = Math.floor((Date.now() - sinceMs) / 1000).toString();

  do {
    const params = new URLSearchParams({
      container_id_type: "chat",
      container_id: config.chatId,
      page_size: "50",
      start_time: startTime,
    });
    if (pageToken) params.set("page_token", pageToken);

    const url = `https://open.feishu.cn/open-apis/im/v1/messages?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      code: number;
      msg: string;
      data?: {
        items?: RawMessage[];
        has_more?: boolean;
        page_token?: string;
      };
    };

    if (data.code !== 0) {
      const retryable = data.code === 99991400 || data.code === 99991672;
      throw {
        kind: "source",
        message: `飞书消息请求失败: ${data.msg}`,
        retryable,
      };
    }

    for (const item of data.data?.items ?? []) {
      messages.push(item);
      if (messages.length >= maxMessages) break;
    }

    pageToken = data.data?.has_more ? data.data.page_token : undefined;
  } while (pageToken && messages.length < maxMessages);

  return messages;
}

function extractTextContent(msg: RawMessage): string {
  try {
    if (msg.msg_type === "text") {
      const parsed = JSON.parse(msg.body.content) as { text?: string };
      return parsed.text ?? msg.body.content;
    }
    if (msg.msg_type === "post") {
      const parsed = JSON.parse(msg.body.content) as {
        title?: string;
        content?: Array<Array<{ tag: string; text?: string }>>;
      };
      const parts: string[] = [];
      if (parsed.title) parts.push(parsed.title);
      for (const line of parsed.content ?? []) {
        const lineText = line
          .filter((el) => el.tag === "text" && el.text)
          .map((el) => el.text)
          .join("");
        if (lineText) parts.push(lineText);
      }
      return parts.join("\n");
    }
    return msg.body.content;
  } catch {
    return msg.body.content;
  }
}

function normalizeMessages(
  messages: RawMessage[],
  messageTypes?: string[],
): NormalizedMessage[] {
  let filtered = messages;
  if (messageTypes?.length) {
    filtered = messages.filter((m) => messageTypes.includes(m.msg_type));
  }

  return filtered.map((m) => ({
    messageId: m.message_id,
    sender: m.sender.sender_type,
    senderId: m.sender.sender_id.open_id,
    type: m.msg_type,
    content: extractTextContent(m),
    createTime: new Date(parseInt(m.create_time, 10) * 1000).toISOString(),
  }));
}

export const feishuBotMeta: ConnectorMeta = {
  name: "feishu-bot",
  displayName: "飞书群消息",
  description:
    "从飞书群聊拉取最近消息。支持按时间范围和消息类型筛选。数据格式为消息对象数组，包含发送者、内容和时间。",
  configSchema: {
    type: "object",
    required: ["chatId"],
    properties: {
      chatId: {
        type: "string",
        description: "群聊 ID（oc_ 开头）",
      },
      since: {
        type: "string",
        description: "时间范围，如 '1h'、'24h'、'7d'，默认 24h",
      },
      messageTypes: {
        type: "array",
        items: { type: "string" },
        description: "消息类型筛选，如 ['text', 'post']",
      },
      maxMessages: {
        type: "number",
        description: "最大消息数，默认 50",
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
  exampleYaml: `groupMessages:
  $source:
    connector: feishu-bot
    chatId: oc_XXXXXXXXXXXXXXXX
    since: 24h
    messageTypes: [text, post]
  ttl: 300
  refresh: lazy`,
};
