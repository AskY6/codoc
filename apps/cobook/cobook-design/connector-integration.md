# Connector 集成：从静态文档到实时数据源

> 将 codoc 的 `$source` loader 从"URL 拉取"扩展为"结构化 connector"体系，让 codoc 能接入飞书表格、飞书文档、飞书群消息等外部数据源。所有现有的 TTL 刷新、DAG 传播、脏标记机制复用，零重写。

---

## 目录

1. [设计动机](#1-设计动机)
2. [架构概览](#2-架构概览)
3. [核心变更：$source 扩展](#3-核心变更source-扩展)
4. [Connector 抽象层](#4-connector-抽象层)
5. [飞书 Connector 实现](#5-飞书-connector-实现)
6. [Workspace 级认证管理](#6-workspace-级认证管理)
7. [Agent 集成](#7-agent-集成)
8. [端到端数据流](#8-端到端数据流)
9. [未来扩展：MCP 作为 connector 后端](#9-未来扩展mcp-作为-connector-后端)
10. [实施计划](#10-实施计划)

---

## 1. 设计动机

当前 `$source` loader 只接受一个 URL 字符串：

```yaml
data:
  weather:
    $source: "https://api.weather.com/current?city=beijing"
    ttl: 3600
```

这对公开 API 够用，但接入飞书等企业平台需要：

| 需求 | URL 模式 | 差距 |
|------|---------|------|
| OAuth/AppToken 认证 | 无 | 认证信息不能写在 YAML 里 |
| 结构化查询（表格 ID、视图、筛选） | 全编码到 URL query | 可读性差、agent 难生成 |
| 分页拉取 | 手动拼 cursor | 每个 API 分页协议不同 |
| 数据归一化 | 返回原始 JSON | 飞书返回嵌套 `items[].fields` 需要展平 |
| 错误分类（限频 vs 认证过期 vs 表格不存在） | 只看 HTTP status | 各平台错误格式不同 |

核心思路：**在现有 `$source` 语义上叠加一层 connector 抽象**，让认证、查询、分页、归一化封装在 connector 内部，YAML 只暴露业务语义。

---

## 2. 架构概览

```
                         codoc YAML
                            │
              ┌─────────────▼──────────────┐
              │   $source loader (扩展)      │
              │   string → URL fetch (不变)  │
              │   object → connector 分发    │
              └─────────────┬──────────────┘
                            │ object path
              ┌─────────────▼──────────────┐
              │   Connector Registry        │
              │   name → ConnectorFn        │
              └─────────────┬──────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                   ▼
  ┌──────────────┐  ┌──────────────┐   ┌──────────────┐
  │ feishu-table │  │ feishu-doc   │   │ feishu-bot   │
  │  connector   │  │  connector   │   │  connector   │
  └──────┬───────┘  └──────┬───────┘   └──────┬───────┘
         │                 │                   │
         ▼                 ▼                   ▼
  ┌─────────────────────────────────────────────────┐
  │            Feishu SDK / Open API                 │
  │      (认证由 CredentialStore 注入)                │
  └─────────────────────────────────────────────────┘
```

关键决策：
- **不新增 loader 类型** — 复用 `$source`，通过值类型（string vs object）区分
- **connector 是纯函数** — `(config, auth) → Promise<unknown>`，无状态，可测试
- **认证在 workspace 层** — 不在 codoc YAML 里，由 CredentialStore 管理
- **TTL/缓存/传播全部复用** — connector 只负责"拿到数据"，剩下的交给 `$source` loader 和 SourceScheduler

---

## 3. 核心变更：$source 扩展

### 3.1 LoaderDeclaration 类型变更

```typescript
// packages/core/src/types.ts

// Before:
| { type: "source"; $source: string; ttl?: number; staleWhileRevalidate?: boolean; refresh?: "eager" | "lazy" }

// After:
| { type: "source"; $source: string | SourceConnectorConfig; ttl?: number; staleWhileRevalidate?: boolean; refresh?: "eager" | "lazy" }

interface SourceConnectorConfig {
  connector: string;              // connector 名称，如 "feishu-table"
  [key: string]: unknown;         // connector 特定配置，透传给 connector 函数
}
```

### 3.2 $source loader 分支

```typescript
// packages/core/src/loader/source.ts

export const sourceLoader: LoaderFn = async (
  field: CodataField,
  _context: ForceContext,
): Promise<unknown> => {
  const decl = field.meta.loader;
  const source = decl.$source;
  const ttl = decl.ttl ?? 0;

  // 分支：string → 原有 URL fetch，object → connector 分发
  if (typeof source === "string") {
    return fetchWithCache(source, ttl, decl.staleWhileRevalidate ?? false);
  }

  // Connector path
  const { connector: connectorName, ...config } = source;
  const connectorFn = getConnector(connectorName);
  if (!connectorFn) {
    throw {
      kind: "source",
      message: `Unknown connector: "${connectorName}"`,
      retryable: false,
    };
  }

  // 缓存 key：connector 名 + config 序列化（确定性 JSON）
  const cacheKey = `connector:${connectorName}:${stableStringify(config)}`;
  return fetchConnectorWithCache(cacheKey, ttl, decl.staleWhileRevalidate ?? false, async () => {
    const auth = getCredentialStore().get(connectorName);
    return connectorFn(config, auth);
  });
};
```

### 3.3 缓存适配

当前缓存以 URL 为 key。connector 没有 URL，需要一个确定性的 cache key：

```typescript
// 新增 fetchConnectorWithCache：与 fetchWithCache 结构一致，但接受 key + fetcher
async function fetchConnectorWithCache(
  cacheKey: string,
  ttl: number,
  swr: boolean,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached) {
    if (now < cached.expiresAt) return cached.value;
    if (swr) {
      fetcher().then((v) => cache.set(cacheKey, { value: v, expiresAt: now + ttl * 1000 })).catch(() => {});
      return cached.value;
    }
  }

  const value = await fetcher();
  if (ttl > 0) {
    cache.set(cacheKey, { value, expiresAt: now + ttl * 1000 });
  }
  return value;
}
```

### 3.4 SourceScheduler 适配

SourceScheduler 当前 eager 刷新时调用 `evictSourceCache(url)`。需要适配 connector 的 cache key：

```typescript
// source-scheduler.ts

private eagerRefresh(path: string): void {
  const field = this.tree.getField(path)!;
  const decl = field.meta.loader;
  const source = decl.$source;

  // Evict: URL or connector cache key
  if (typeof source === "string") {
    evictSourceCache(source);
  } else {
    const { connector, ...config } = source;
    evictSourceCache(`connector:${connector}:${stableStringify(config)}`);
  }

  this.tree.refreshField(path);
  this.tree.observe(path).then(
    () => propagateAndInvalidate(this.dag, this.tree, [path]),
    () => {},
  );
}
```

### 3.5 YAML 解析适配

`codoc-loader.ts` 中 `buildFields` 解析 `$source` 时需要兼容 object：

```typescript
// 当前：data 中遇到 { $source: "..." } → type: "source"
// 扩展：data 中遇到 { $source: { connector: "...", ... } } → 同样 type: "source"
// 无需改动解析逻辑 — $source 的值类型已经是 any，只是 TypeScript 类型需要更新
```

实际上 `buildFields` 只检查 key 名 (`$source`)，不检查 value 类型，所以 **解析层零改动**。

---

## 4. Connector 抽象层

### 4.1 接口定义

```typescript
// packages/core/src/connector/types.ts

/**
 * Connector 函数：给定配置和认证信息，返回数据。
 * 纯函数，无状态，可单测。
 */
export type ConnectorFn = (
  config: Record<string, unknown>,
  auth: ConnectorAuth | undefined,
) => Promise<unknown>;

/**
 * Connector 认证信息，各平台不同。
 * 具体结构由 connector 自己定义和校验。
 */
export type ConnectorAuth = Record<string, unknown>;

/**
 * Connector 元信息，用于 agent 生成 YAML 时提供字段说明。
 */
export interface ConnectorMeta {
  name: string;                           // "feishu-table"
  displayName: string;                    // "飞书多维表格"
  description: string;                    // 给 agent 看的能力说明
  configSchema: Record<string, unknown>;  // JSON Schema for config
  authSchema: Record<string, unknown>;    // JSON Schema for auth
  exampleYaml: string;                    // 示例 YAML 片段
}
```

### 4.2 Connector Registry

```typescript
// packages/core/src/connector/registry.ts

const connectors = new Map<string, { fn: ConnectorFn; meta: ConnectorMeta }>();

export function registerConnector(meta: ConnectorMeta, fn: ConnectorFn): void {
  connectors.set(meta.name, { fn, meta });
}

export function getConnector(name: string): ConnectorFn | undefined {
  return connectors.get(name)?.fn;
}

export function getConnectorMeta(name: string): ConnectorMeta | undefined {
  return connectors.get(name)?.meta;
}

export function listConnectors(): ConnectorMeta[] {
  return [...connectors.values()].map((c) => c.meta);
}
```

### 4.3 Credential Store

```typescript
// packages/core/src/connector/credential-store.ts

/**
 * Workspace 级别的认证信息存储。
 * 运行时注入，不持久化到 codoc YAML 中。
 */
class CredentialStore {
  private creds = new Map<string, ConnectorAuth>();

  set(connectorName: string, auth: ConnectorAuth): void {
    this.creds.set(connectorName, auth);
  }

  get(connectorName: string): ConnectorAuth | undefined {
    return this.creds.get(connectorName);
  }

  has(connectorName: string): boolean {
    return this.creds.has(connectorName);
  }
}

let store: CredentialStore | undefined;

export function getCredentialStore(): CredentialStore {
  if (!store) store = new CredentialStore();
  return store;
}
```

认证信息来源（按优先级）：
1. 环境变量：`FEISHU_APP_ID`, `FEISHU_APP_SECRET`
2. Workspace 配置文件：`docs/.cobook/credentials.yaml`（gitignored）
3. 运行时注入：启动时调用 `credentialStore.set("feishu", { appId, appSecret })`

---

## 5. 飞书 Connector 实现

### 5.1 feishu-table connector

```typescript
// packages/connectors/feishu/src/table.ts

import type { ConnectorFn, ConnectorMeta } from "@codoc/core";

interface FeishuTableConfig {
  appToken: string;           // 多维表格 app token
  tableId: string;            // 数据表 ID
  viewId?: string;            // 视图 ID（可选，不指定则默认视图）
  fields?: string[];          // 要拉取的字段名（不指定则全部）
  filter?: Record<string, unknown>;  // 简单键值筛选
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
  maxRecords?: number;        // 最大记录数，默认 100
}

interface FeishuAuth {
  appId: string;
  appSecret: string;
}

export const feishuTableConnector: ConnectorFn = async (rawConfig, rawAuth) => {
  const config = rawConfig as FeishuTableConfig;
  const auth = rawAuth as FeishuAuth;

  if (!auth?.appId || !auth?.appSecret) {
    throw { kind: "source", message: "飞书认证未配置：缺少 appId 或 appSecret", retryable: false };
  }

  // 1. 获取 tenant_access_token
  const token = await getTenantToken(auth.appId, auth.appSecret);

  // 2. 拉取记录（自动分页）
  const records = await fetchAllRecords(token, config);

  // 3. 归一化：从飞书嵌套格式 → 扁平对象数组
  return normalizeRecords(records, config.fields);
};

async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw {
      kind: "source",
      message: `飞书认证失败: ${data.msg}`,
      retryable: data.code === 99991400,  // rate limit
    };
  }
  return data.tenant_access_token;
}

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

    // 飞书筛选用 filter 参数（FQL 语法）
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
    const data = await res.json();

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
  // 简单键值 → FQL AND 条件
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
```

### 5.2 feishu-doc connector（后续）

```typescript
// 从飞书文档拉取内容（Markdown 格式）
// $source:
//   connector: feishu-doc
//   docToken: doccnXXXXXX
//   format: markdown     # markdown | text | blocks
```

### 5.3 feishu-bot connector（后续）

```typescript
// 从飞书群拉取最近消息
// $source:
//   connector: feishu-bot
//   chatId: oc_XXXXXXXX
//   since: 24h           # 时间范围
//   messageTypes: [text, post]
```

---

## 6. Workspace 级认证管理

### 6.1 认证配置文件

```yaml
# docs/.cobook/credentials.yaml（gitignored）

feishu:
  appId: cli_xxxxxxxxx
  appSecret: xxxxxxxxxxxxxxxxx

# 未来扩展
# notion:
#   token: secret_xxxxx
# linear:
#   apiKey: lin_api_xxxxx
```

### 6.2 启动时加载

```typescript
// apps/cobook/src/workspace/api/_workspace.ts

import { loadCredentials } from "./credentials.js";

export async function getWorkspace(): Promise<Workspace> {
  if (!g._ws) {
    ensureLLMClient();
    const docsDir = resolve(process.cwd(), "docs");
    await mkdir(docsDir, { recursive: true });

    // 加载认证信息
    await loadCredentials(docsDir);

    // 注册 connectors
    registerBuiltinConnectors();

    g._ws = await Workspace.create(docsDir);
  }
  return g._ws;
}
```

```typescript
// apps/cobook/src/workspace/api/credentials.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { getCredentialStore } from "@codoc/core";

export async function loadCredentials(docsDir: string): Promise<void> {
  const credPath = join(docsDir, ".cobook", "credentials.yaml");
  try {
    const content = await readFile(credPath, "utf-8");
    const creds = parseYaml(content);
    const store = getCredentialStore();
    for (const [name, auth] of Object.entries(creds)) {
      store.set(name, auth as Record<string, unknown>);
    }
  } catch {
    // 文件不存在或解析失败 — 静默跳过
    // connector 在运行时会报"认证未配置"的明确错误
  }
}
```

### 6.3 环境变量覆盖

环境变量优先于配置文件：

```typescript
function registerBuiltinConnectors(): void {
  const store = getCredentialStore();

  // 飞书：环境变量覆盖
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    store.set("feishu", {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
    });
  }

  registerConnector(feishuTableMeta, feishuTableConnector);
  // registerConnector(feishuDocMeta, feishuDocConnector);
  // registerConnector(feishuBotMeta, feishuBotConnector);
}
```

---

## 7. Agent 集成

### 7.1 codoc-agent 感知 connector

codoc-agent 的 system prompt 需要新增 connector 知识。通过 `ConnectorMeta.exampleYaml` 动态注入可用 connector 列表：

```typescript
// agents/codoc-agent.ts — system prompt 动态拼接

function buildConnectorContext(): string {
  const metas = listConnectors();
  if (metas.length === 0) return "";

  const lines = ["## 可用数据源 Connectors\n"];
  for (const meta of metas) {
    const authConfigured = getCredentialStore().has(meta.name) ? "已配置" : "未配置";
    lines.push(`### ${meta.displayName} (\`${meta.name}\`) — 认证${authConfigured}`);
    lines.push(meta.description);
    lines.push("```yaml");
    lines.push(meta.exampleYaml);
    lines.push("```\n");
  }
  return lines.join("\n");
}
```

### 7.2 对话式接入流程

用户说"帮我接入飞书表格"时的理想对话流：

```
用户: 帮我接入飞书多维表格，拉取项目任务列表

codoc-agent: 好的，我需要以下信息来创建 codoc：
1. 多维表格的 app_token（在表格 URL 中）
2. 数据表 ID（在表格页面的 API 面板中）
3. 需要哪些字段？
4. 需要筛选条件吗？

用户: app_token 是 bascnABC123，表 ID 是 tblXYZ789，
     我要"任务名"、"负责人"、"状态"、"截止日期"，
     只看状态是"进行中"的

codoc-agent: 明白。我会创建一个看板 codoc，每 5 分钟从飞书拉取数据，
并用 AI 生成任务摘要。

<intent>
{"kind": "create-codoc", "payload": {
  "docId": "project-tasks.codoc",
  "content": "type:\n  properties:\n    tasks:\n      type: array\n    digest:\n      type: string\n\ndata:\n  tasks:\n    $source:\n      connector: feishu-table\n      appToken: bascnABC123\n      tableId: tblXYZ789\n      fields: [任务名, 负责人, 状态, 截止日期]\n      filter:\n        状态: 进行中\n    ttl: 300\n    refresh: lazy\n  digest:\n    $prompt:\n      template: \"基于以下进行中的任务生成简要摘要：{tasks}\"\n\nview: |\n  # 项目任务看板\n  <InfoRow label=\"数据源\">飞书多维表格 (每 5 分钟刷新)</InfoRow>\n  <AIBlock label=\"任务摘要\">{digest}</AIBlock>\n"
}}
</intent>
```

### 7.3 认证缺失时的引导

当 connector 调用失败（认证未配置）时，系统消息引导用户：

```typescript
// codoc-use/events.ts 中增加 connector 错误处理

// 当 $source connector 字段进入 error 状态且 message 包含"认证未配置"时，
// 发送引导消息
if (field.state.status === "error" && field.state.error.kind === "source") {
  const msg = field.state.error.message;
  if (msg.includes("认证未配置")) {
    chat.sendMessage(sessionId, {
      sender: { id: "system", kind: "agent" },
      content: `字段 \`${path}\` 需要飞书认证。请在 \`docs/.cobook/credentials.yaml\` 中配置：\n\n\`\`\`yaml\nfeishu:\n  appId: your_app_id\n  appSecret: your_app_secret\n\`\`\`\n\n或设置环境变量 \`FEISHU_APP_ID\` 和 \`FEISHU_APP_SECRET\`。`,
    });
  }
}
```

---

## 8. 端到端数据流

### 8.1 首次创建 + 加载

```
用户确认 create-codoc intent
  → workspace.createDoc("project-tasks.codoc", yaml)
  → parseCodoc → buildFields:
      /tasks  → { type: "source", $source: { connector: "feishu-table", ... }, ttl: 300 }
      /digest → { type: "prompt", $prompt: { template: "...{tasks}" } }
  → workspace.loadDoc("project-tasks.codoc")
      → DAG: /digest depends on /tasks
      → SourceScheduler.register("/tasks") → setInterval(300s)
  → scheduleForce(tree, dag)
      Layer 0: observe("/tasks")
        → sourceLoader → connector path
        → getConnector("feishu-table")
        → credentialStore.get("feishu") → { appId, appSecret }
        → feishuTableConnector({ appToken, tableId, fields, filter }, auth)
        → getTenantToken → fetchAllRecords → normalizeRecords
        → 返回 [{任务名: "...", 负责人: "...", ...}, ...]
        → cache.set("connector:feishu-table:...", { value, expiresAt })
        → field.state = { status: "resolved", value: [...] }
      Layer 1: observe("/digest")
        → promptLoader → context.force("/tasks") → 已 resolved，直接返回
        → 插值模板 → LLM 生成摘要
        → field.state = { status: "resolved", value: "..." }
  → SSE 推送 field events → 前端渲染
```

### 8.2 TTL 刷新周期

```
T=300s: SourceScheduler 定时器触发 (lazy)
  → tree.invalidateField("/tasks") → status: dirty
  → propagateAndInvalidate(dag, tree, ["/tasks"])
    → /digest 也标记为 dirty
  → workspace change listeners 触发
  → SSE 推送 field dirty events

（下次 observe 时才会实际 fetch）

T=next observe:
  → sourceLoader → cache expired → feishuTableConnector 重新拉取
  → 新数据写入 → /tasks resolved
  → /digest 重新生成 → resolved
  → SSE 推送 resolved events
```

### 8.3 跨文档传播

```yaml
# project-tasks.codoc
data:
  tasks:
    $source:
      connector: feishu-table
      ...

# weekly-report.codoc
data:
  taskSnapshot:
    $ref: "[[project-tasks.codoc]]/tasks"
  report:
    $prompt:
      template: "基于以下任务生成周报：{taskSnapshot}"
```

```
project-tasks /tasks TTL 刷新 → dirty
  → cross-doc subscription 触发
  → weekly-report /taskSnapshot invalidate → dirty
  → weekly-report /report invalidate → dirty
  → 下次 observe 时级联刷新
```

---

## 9. 未来扩展：MCP 作为 connector 后端

> 当前阶段以原生 API connector 为主（飞书 MCP 支持有限）。MCP connector 作为后续增量，复用同一套 connector 抽象。

### 9.1 两条数据通路的关系

```
路径 A: Agent 对话时按需调用（MCP tool）
  用户提问 → codoc-agent → MCP tool call → 拿到数据 → 回复用户
  特点：一次性、对话式、LLM 参与

路径 B: codoc 字段持续同步（$source connector）
  $source 字段 → connector → API → 字段值 → DAG 传播 → TTL 自动刷新
  特点：持久化、响应式、无 LLM 参与
```

两条路径互补：A 是"帮我看看飞书表格里有什么"，B 是"这个字段永远反映飞书表格的最新状态"。当飞书 MCP server 成熟后，B 可以委托给 A 的基础设施。

### 9.2 MCP connector 设计预留

当 MCP 就绪时，只需新增一个 `mcp` connector，不改动 core：

```yaml
# 未来：通过 MCP server 拉取数据
data:
  tasks:
    $source:
      connector: mcp               # 通用 MCP connector
      server: feishu               # MCP server 名称
      tool: read_bitable_records   # MCP tool 名称
      args:                        # 透传给 MCP tool
        app_token: bascnXXX
        table_id: tblXXX
    ttl: 300
```

```typescript
// 未来实现：packages/connectors/mcp/src/index.ts
export const mcpConnector: ConnectorFn = async (config, _auth) => {
  const { server, tool, args } = config as { server: string; tool: string; args: Record<string, unknown> };
  // 委托给 MCP client
  return mcpClient.callTool(server, tool, args);
};
```

MCP connector 的优势（待飞书 MCP 成熟后）：
- **零平台代码** — 接一个 MCP server 即可，不需要写 connector 实现
- **认证由 MCP server 管理** — CredentialStore 不需要介入
- **ConnectorMeta 从 MCP tool schema 动态生成** — agent 自动感知新能力

### 9.3 架构兼容性

当前的 connector 抽象层天然兼容 MCP 路径：

| 组件 | 原生 connector | MCP connector |
|------|---------------|---------------|
| ConnectorFn 签名 | `(config, auth) => Promise<unknown>` | 相同 |
| 注册方式 | `registerConnector(meta, fn)` | 相同 |
| 缓存 | `fetchConnectorWithCache` | 相同 |
| TTL 刷新 | SourceScheduler | 相同 |
| DAG 传播 | propagateAndInvalidate | 相同 |

迁移路径：当飞书 MCP server 覆盖了足够的 API 后，可以逐步将 `feishu-table` connector 的实现从直接调 API 切换到委托 MCP，对 codoc YAML 完全透明（用户不感知）。

### 9.4 选择原生 vs MCP 的判断标准

| 场景 | 推荐 | 原因 |
|------|------|------|
| 飞书多维表格读取 | 原生 | MCP 支持有限，原生可控 |
| 高频 TTL（< 60s） | 原生 | MCP 有序列化/进程通信 overhead |
| 平台 API 复杂（分页/FQL/归一化） | 原生 | connector 内部可精细控制 |
| 平台已有成熟 MCP server | MCP | 零代码接入 |
| 快速验证新数据源 | MCP | 不需要写 connector |
| Agent 对话中按需查询 | MCP | 天然适合 tool call |

---

## 10. 实施计划

### 10.1 优先级

```
P0  $source 类型扩展 + connector registry         → 所有 connector 的基础
P0  CredentialStore + 认证加载                     → connector 运行的前提
P0  feishu-table connector                        → 核心场景
P0  $source loader 分支 + cache 适配               → 打通数据流
P0  SourceScheduler 适配 connector cache key       → TTL 刷新正常工作

P1  codoc-agent connector 上下文注入               → agent 能生成 connector YAML
P1  认证缺失引导消息                               → 用户知道怎么配认证
P1  feishu token 缓存（tenant_access_token 有效期 2h）→ 避免每次请求都获取 token

P2  feishu-doc connector                          → 文档内容拉取
P2  feishu-bot connector                          → 群消息拉取
P2  Connector 健康检查 UI                          → 左栏显示 connector 状态
P2  credentials 加密存储                           → 安全加固

P3  mcp connector（通用）                          → 当飞书 MCP 成熟后，一行注册接入
P3  ConnectorMeta 从 MCP tool schema 动态生成      → agent 自动感知 MCP 数据源
P3  原生 connector → MCP 迁移工具                   → 平滑过渡
```

### 10.2 阶段划分

#### Phase 1：打通 connector 管道

```
packages/core
  ├→ src/types.ts                        — SourceConnectorConfig 类型
  ├→ src/connector/types.ts              — ConnectorFn, ConnectorAuth, ConnectorMeta
  ├→ src/connector/registry.ts           — registerConnector, getConnector, listConnectors
  ├→ src/connector/credential-store.ts   — CredentialStore
  ├→ src/loader/source.ts               — 分支逻辑 + fetchConnectorWithCache
  ├→ src/source-scheduler.ts            — 适配 connector cache key
  └→ src/index.ts                       — 导出新 API

packages/connectors/feishu               — 新 package
  ├→ src/auth.ts                        — getTenantToken (带缓存)
  ├→ src/table.ts                       — feishuTableConnector + meta
  └→ src/index.ts                       — 导出

apps/cobook
  ├→ src/workspace/api/_workspace.ts    — loadCredentials + registerBuiltinConnectors
  ├→ src/workspace/api/credentials.ts   — 认证文件加载
  └→ docs/.cobook/credentials.yaml.example  — 模板

验证：手动创建含 $source connector 的 codoc → 数据拉取成功 → TTL 刷新 → DAG 传播
```

#### Phase 2：Agent + 体验

```
apps/cobook
  ├→ src/agents/codoc-agent.ts          — system prompt 注入 connector 上下文
  ├→ src/codoc-use/events.ts            — 认证缺失引导消息
  └→ 测试                               — 对话式创建含 connector 的 codoc

验证：在 chat 中说"接入飞书表格" → agent 生成含 connector 的 codoc → confirm → 数据拉取
```

#### Phase 3：更多 connector + 安全

```
packages/connectors/feishu
  ├→ src/doc.ts                         — feishu-doc connector
  └→ src/bot.ts                         — feishu-bot connector

apps/cobook
  └→ UI: connector 健康检查面板
```

#### Phase 4：MCP connector 增量（待飞书 MCP 成熟后）

```
packages/connectors/mcp                  — 新 package
  ├→ src/index.ts                       — 通用 mcp connector 实现
  └→ src/meta-adapter.ts               — MCP tool schema → ConnectorMeta 转换

apps/cobook
  └→ src/workspace/api/_workspace.ts    — 注册 mcp connector

验证：配置飞书 MCP server → codoc YAML 中用 connector: mcp → 数据拉取 → TTL 正常
迁移：将 feishu-table 实现从原生 API 切换到委托 MCP，codoc YAML 不变
```

### 10.3 文件变更清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/types.ts` | 新增 `SourceConnectorConfig`，扩展 `$source` 类型 |
| `packages/core/src/connector/types.ts` | 新增 `ConnectorFn`, `ConnectorAuth`, `ConnectorMeta` |
| `packages/core/src/connector/registry.ts` | 新增 connector 注册表 |
| `packages/core/src/connector/credential-store.ts` | 新增认证存储 |
| `packages/core/src/loader/source.ts` | 分支：string → URL，object → connector |
| `packages/core/src/source-scheduler.ts` | 适配 connector cache key |
| `packages/core/src/index.ts` | 导出 connector API |
| `packages/connectors/feishu/` | 新 package：飞书 connector 实现 |
| `apps/cobook/src/workspace/api/_workspace.ts` | 加载认证 + 注册 connector |
| `apps/cobook/src/workspace/api/credentials.ts` | 新增：认证文件加载 |
| `apps/cobook/src/agents/codoc-agent.ts` | system prompt 注入 connector 上下文 |
| `apps/cobook/src/codoc-use/events.ts` | 认证缺失引导消息 |
| `apps/cobook/docs/.cobook/credentials.yaml.example` | 认证配置模板 |
