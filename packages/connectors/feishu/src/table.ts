import type { ConnectorFn, ConnectorMeta } from "@codoc/core";
import { getTenantToken } from "./auth.js";

interface FeishuTableConfig {
  appToken: string;
  tableId: string;
  viewId?: string;
  fields?: string[];
  filter?: Record<string, unknown>;
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
  maxRecords?: number;
}

interface FeishuAuth {
  appId: string;
  appSecret: string;
}

export const feishuTableConnector: ConnectorFn = async (rawConfig, rawAuth) => {
  const config = rawConfig as FeishuTableConfig;
  const auth = rawAuth as FeishuAuth | undefined;

  if (!auth?.appId || !auth?.appSecret) {
    throw {
      kind: "source",
      message: "飞书认证未配置：缺少 appId 或 appSecret",
      retryable: false,
    };
  }

  const token = await getTenantToken(auth.appId, auth.appSecret);
  const records = await fetchAllRecords(token, config);
  return normalizeRecords(records, config.fields);
};

async function fetchAllRecords(
  token: string,
  config: FeishuTableConfig,
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  const maxRecords = config.maxRecords ?? 100;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);
    if (config.viewId) params.set("view_id", config.viewId);
    if (config.filter) {
      params.set("filter", buildFQL(config.filter));
    }
    if (config.sort?.length) {
      params.set("sort", JSON.stringify(config.sort.map((s) => ({
        field_name: s.field,
        desc: s.order === "desc",
      }))));
    }

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as {
      code: number;
      msg: string;
      data?: { items?: Array<{ fields: Record<string, unknown> }>; has_more?: boolean; page_token?: string };
    };

    if (data.code !== 0) {
      const retryable = data.code === 99991400 || data.code === 99991672;
      throw { kind: "source", message: `飞书表格请求失败: ${data.msg}`, retryable };
    }

    for (const item of data.data?.items ?? []) {
      records.push(item.fields);
      if (records.length >= maxRecords) break;
    }

    pageToken = data.data?.has_more ? data.data.page_token : undefined;
  } while (pageToken && records.length < maxRecords);

  return records;
}

function normalizeRecords(
  records: Array<Record<string, unknown>>,
  fields?: string[],
): Array<Record<string, unknown>> {
  if (!fields) return records;
  return records.map((r) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      out[f] = r[f] ?? null;
    }
    return out;
  });
}

function buildFQL(filter: Record<string, unknown>): string {
  return Object.entries(filter)
    .map(([k, v]) => `CurrentValue.[${k}] = "${v}"`)
    .join(" AND ");
}

export const feishuTableMeta: ConnectorMeta = {
  name: "feishu-table",
  displayName: "飞书多维表格",
  description: "从飞书多维表格（Bitable）拉取记录。支持视图筛选、字段选择、排序。数据格式为对象数组。",
  configSchema: {
    type: "object",
    required: ["appToken", "tableId"],
    properties: {
      appToken: { type: "string", description: "多维表格的 app_token（URL 中获取）" },
      tableId: { type: "string", description: "数据表 ID" },
      viewId: { type: "string", description: "视图 ID（可选）" },
      fields: { type: "array", items: { type: "string" }, description: "要拉取的字段名列表" },
      filter: { type: "object", description: "简单键值筛选条件" },
      maxRecords: { type: "number", description: "最大记录数，默认 100" },
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
  exampleYaml: `activeTasks:
  $source:
    connector: feishu-table
    appToken: bascnXXXXXX
    tableId: tblXXXXXX
    fields: [任务名, 负责人, 状态, 优先级]
    filter:
      状态: 进行中
  ttl: 300
  refresh: lazy`,
};
