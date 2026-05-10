# Workspace Plugin 设计

## 背景

当前 `apps/local` 已经有几类扩展点，但它们彼此是分散的：

- `templates/` 负责初始化工作区骨架
- `@cobook/parser` 的 `SourceProvider` 负责 `$source`
- `providers/` 负责外部 CLI chat backend
- `api-routes.ts` 和 `mcp-server.ts` 暴露本地 HTTP API 与 MCP tools
- `rss-scheduler.ts` 负责周期刷新

注意：`rss-scheduler.ts` 这个文件名有误导性。按现有实现，它实际上是“通用 periodic source scheduler”，扫描的是所有带 `interval` 的 `$source` 字段，而不是 RSS 专属调度器。

这些扩展点现在都由 `http-server.ts` 和若干全局文件硬编码装配。RSS 之所以“入侵主流程”，本质原因不是 RSS 业务本身复杂，而是它没有一个统一的垂直边界，只能把逻辑散落在全局入口里。

当前结果是：

- RSS template 只是 scaffold，不是 runtime owner
- RSS UI 行为、MCP tools、scheduler、文章状态更新都散落在全局模块里
- “RSS 工作区”没有成为一个一等公民的产品单元，而只是“某套 codoc 文件 + 一堆 prompt”

## 目标

引入 `WorkspacePlugin`，把一个垂直工作区体验的 runtime 能力收敛到单一边界内。

第一版目标：

- 让 RSS 以 plugin 形式落地，停止继续污染 `apps/local` 主流程
- 让工作区的 runtime 能力由 plugin 决定，而不是由 template prompt 决定
- 保留 `codoc` 作为底层存储格式，不改动 `@cobook/core` 的抽象
- 保持本地版可用，不引入动态插件安装、版本管理、权限沙箱等重机制

明确非目标：

- 第一版不做外部可安装插件系统
- 第一版不做 npm 包级别的 plugin marketplace
- 第一版不把 plugin 抽到 `packages/` 作为跨本地/服务端共享层
- 第一版不支持一个 workspace 同时启用多个垂直 plugin

## 设计原则

### 1. Plugin 生长在 app layer，不进入 core

`WorkspacePlugin` 只存在于 `apps/local`。

- `@cobook/core` 继续只管 `codoc / dag / cobook`
- `@cobook/parser` 继续提供 `SourceProvider` port
- `apps/local` 负责装配具体的 workspace runtime

这样可以避免为了 RSS 或 bookmarks 改动 core 的抽象边界。

### 2. 一个 workspace 先只绑定一个 plugin

第一版使用单值配置：

```json
{
  "port": 4321,
  "workspaceKind": "rss"
}
```

而不是：

```json
{
  "plugins": ["rss", "bookmarks"]
}
```

原因：

- 现阶段的 workspace 更像“一个垂直产品体验”，不是能力自由组合平台
- 多 plugin 并存会立刻带来 UI、路由、命令、source provider、调度任务冲突
- 单 plugin 足够覆盖 RSS / bookmarks / default 这类工作区

### 3. Template 只是初始化入口，plugin 才是 runtime owner

template 负责：

- 初始化 `.codoc` 文件
- 安装组件
- 写入默认配置

plugin 负责：

- source providers
- runtime API
- MCP tools
- plugin-specific background jobs
- UI 导航与 domain action
- chat/system prompt 贡献

也就是说，RSS 不应该继续表现为“一个模板”，而应该是“一个工作区种类”。

### 4. 第一版采用编译期注册，不做动态加载

`WorkspacePlugin` 第一版直接内建在仓库里，通过 registry 注册：

- 简单
- 可测试
- 不引入模块发现、签名、权限、版本兼容问题

等接口稳定后，再考虑动态 plugin。

### 5. 平台能力与垂直能力严格拆开

不是所有“被 RSS 用到的东西”都应该归 RSS plugin 所有。

例如当前的 `rss-scheduler.ts` 虽然名字带 RSS，但实现上是通用 source runtime：

- 扫描所有 codoc 的 `$source` + `interval`
- 检查 `.source-state.json`
- 调用对应 provider 的 `execute()` / `merge()`

因此它应该保留为平台能力，最多重命名为 `source-scheduler.ts`，而不是迁入 `plugins/rss/`。

Plugin 只拥有“垂直领域特有”的行为：

- RSS 的订阅管理
- digest 生成
- article read/star 状态语义
- RSS 专属 API / MCP tools / UI 动作

## 总体模型

### 核心概念

#### `WorkspacePlugin`

一个垂直工作区能力包。

它可以贡献：

- workspace template
- source providers
- API routes
- MCP tools
- plugin-specific background jobs
- chat contribution
- UI descriptor

#### `workspaceKind`

工作区绑定的 plugin id，例如：

- `default`
- `rss`
- `bookmarks`

#### `pluginConfig`

plugin 自己拥有的一段 opaque 配置，挂在 `codoc.config.json` 里。

配置分层应该明确拆开：

- root config：宿主 / 平台级字段
- `pluginConfig`：某个 `workspaceKind` 的领域字段

例如：

```json
{
  "port": 4321,
  "workspaceKind": "rss",
  "pluginConfig": {
    "defaultSourceIntervalMinutes": 30,
    "digestCodocPath": "inbox.codoc",
    "sourcesDir": "sources"
  }
}
```

字段归属规则：

- root config 放宿主级字段，例如 `port`、`workspaceKind`
- `pluginConfig` 放垂直领域字段，例如 RSS 的刷新周期、digest 路径、source 目录

`port` 不属于任何 plugin。它是本地 HTTP server 的启动参数，因此必须保留在根配置，而不是塞进 `pluginConfig`。

这样做的好处：

- 宿主在激活 plugin 之前就能读取并应用平台级配置
- plugin schema 不会污染全局字段空间
- 更换 `workspaceKind` 时，平台字段语义保持稳定

额外约束：

- 如果某个配置项只是“新建内容时写入的默认值”，它不应该伪装成 runtime override
- 对 RSS 来说，真正驱动平台 scheduler 的仍然是每个 `$source` 字段上的 `interval`
- 因此 workspace 级字段必须明确表达成“默认值”，而不是“全局调度间隔”

## 推荐目录结构

第一版建议在 `apps/local/src/plugins/` 下建立 plugin 系统。

```text
apps/local/src/plugins/
  AGENTS.md
  types.ts
  registry.ts
  config.ts
  detect.ts
  default/
    AGENTS.md
    index.ts
  rss/
    AGENTS.md
    index.ts
    template.ts
    config.ts
    api-routes.ts
    mcp-tools.ts
    jobs.ts
    service.ts
    detect.ts
    ui.ts
  bookmarks/
    AGENTS.md
    index.ts
```

说明：

- `types.ts`：`WorkspacePlugin` 主接口
- `registry.ts`：内建 plugin 注册表
- `config.ts`：workspace config 解析与 plugin config 归一化
- `detect.ts`：为 legacy workspace 做 plugin 自动识别
- `rss/`：RSS plugin 的全部 runtime owner

如果新增 `plugins/rss/`、`plugins/bookmarks/` 目录，必须同步补 `AGENTS.md`，符合当前 tree-based context 规则。

## 接口设计

下面给出第一版建议接口。重点是够用，而不是把未来所有灵活性一次设计完。

### `WorkspacePlugin`

```ts
import type { EventEmitter } from "node:events";
import type { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Workspace } from "../workspace.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Template } from "../templates/types.js";
import type { SourceProvider } from "@cobook/parser";
import type { Result } from "@cobook/core";

export interface HostWorkspaceConfig {
  // host/platform-level config
  port?: number;
  workspaceKind?: string;
  pluginConfig?: Record<string, unknown>;
}

export interface LegacyInteractionHints {
  /** @deprecated Prefer plugin-defined UI actions over config-declared commands. */
  commands?: Array<{ name: string; description: string; prompt: string }>;
  /** @deprecated Prefer plugin-defined UI actions over config-declared quick actions. */
  quickActions?: Array<{ label: string; prompt: string }>;
  /** @deprecated Legacy per-workspace system prompt append. Plugin prompt comes first. */
  agentInstructions?: string;
}

export type WorkspaceConfigFile =
  & HostWorkspaceConfig
  & LegacyInteractionHints;

export interface PluginConfigError {
  readonly kind: "invalid-plugin-config";
  readonly pluginId: string;
  readonly message: string;
  readonly issues?: readonly string[];
}

export interface WorkspacePluginContext<C> {
  readonly workspaceName: string;
  readonly workspace: Workspace;
  readonly config: WorkspaceConfigFile;
  readonly pluginConfig: C;
  readonly updates: EventEmitter;
  readonly providerRegistry: ProviderRegistry;
}

export interface PluginJobHandle {
  readonly ready?: Promise<void>;
  stop(): void;
}

export type WorkspaceUiActionDescriptor =
  | {
      readonly kind: "rest";
      readonly id: string;
      readonly label: string;
      readonly method: "GET" | "POST" | "PATCH" | "DELETE";
      readonly path: string;
    }
  | {
      readonly kind: "chat-prompt";
      readonly id: string;
      readonly label: string;
      readonly prompt: string;
    };

export interface WorkspaceUiSpec {
  readonly homeView?: "tree" | "inbox";
  readonly hiddenPaths?: readonly string[];
  readonly primaryActions?: readonly WorkspaceUiActionDescriptor[];
}

export interface WorkspacePlugin<C = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  // optional legacy workspace detection
  detectWorkspace?(workspace: Workspace, config: WorkspaceConfigFile): boolean;

  // optional scaffold template for `codoc init --from`
  readonly template?: Template;

  // plugin-owned config parsing: raw JSON -> typed config
  parseConfig(
    raw: Record<string, unknown> | undefined,
  ): Result<C, PluginConfigError>;

  // source providers contributed by this plugin
  sourceProviders?(): readonly SourceProvider[];

  // REST routes mounted under /api/plugins/<plugin-id> or /api/<plugin-prefix>
  createApiRoutes?(ctx: WorkspacePluginContext<C>): Hono;

  // extra MCP tools appended to the shared MCP server
  registerMcpTools?(server: McpServer, ctx: WorkspacePluginContext<C>): void;

  // plugin-specific background jobs started on workspace open and stopped on close
  startJobs?(ctx: WorkspacePluginContext<C>): readonly PluginJobHandle[];

  // extra system prompt contribution for local chat providers
  getAgentInstructions?(ctx: WorkspacePluginContext<C>): string | undefined;

  // UI hints for local SPA
  getUiSpec?(ctx: WorkspacePluginContext<C>): WorkspaceUiSpec;
}
```

### 为什么接口是这样

#### `template` 放在 plugin 上

当前 `templates/index.ts` 是单独 registry，但实际业务上模板和 runtime 属于同一垂直领域。RSS 的 scaffold 应该由 RSS plugin 持有。

#### `sourceProviders()` 是 plugin 贡献，而不是 plugin 本体

`SourceProvider` 仍然是 parser 层 port。plugin 只是把某些 provider 加入 registry。

#### `createApiRoutes()` 和 `registerMcpTools()` 分离

本地 UI 和 agent 的交互面不同：

- UI 适合走显式 REST 动作
- agent 适合走 MCP tools

RSS 同时需要两者，但它们不应该耦合成一套接口。

#### `parseConfig()` 比 `Record<string, unknown>` 更重要

`pluginConfig` 在磁盘上仍然是原始 JSON，但 plugin 不应该在运行时到处写 `as RssPluginConfig`。

推荐约束是：

- 宿主读取原始 `pluginConfig?: Record<string, unknown>`
- plugin 通过 `parseConfig()` 一次性解析成类型化配置 `C`
- 后续 runtime 只消费 `WorkspacePluginContext<C>.pluginConfig`

这样才能把“非法状态”拦在 plugin 边界，而不是把未解析的 `unknown` 扩散到业务代码内部。

注意：`default` plugin 也必须显式实现 `parseConfig()`。

推荐做法是：

- `default.parseConfig(undefined | raw)` 返回 `ok({})`

这样“我不需要 plugin config”也是一个被显式解析出来的合法状态，而不是靠跳过验证隐式成立。

#### `startJobs()` 只承载 plugin-specific jobs

像“扫描所有 periodic `$source` 并刷新缓存”这种能力是平台 runtime，不属于某个 vertical plugin。

`startJobs()` 只应该承载 plugin-specific job，例如：

- RSS 的 digest 预生成
- stale feed 提醒
- bookmarks 的归档清理

如果一个 job 对所有 `$source` 都适用，它就不该进入 `plugins/rss/`。

#### `WorkspaceUiSpec.primaryActions` 必须是可执行协议，不是 opaque string

`action: "rss.refresh"` 这种字符串标识不够，因为 UI 无法知道它该如何 dispatch。

因此第一版直接把 action 描述建模成协议：

- `kind: "rest"`：UI 发 HTTP 请求
- `kind: "chat-prompt"`：UI 发送 prompt 给 chat

这样不需要前端再维护一份隐式映射表。

## V1 已知缺口

第一版接口故意没有把 workspace 生命周期钩子一次性做完。

当前已知缺口：

- `onWorkspaceOpen`
- `onWorkspaceClose`
- `onCodocChanged`

原因：

- V1 先要解决“边界收敛”，不是把 plugin runtime 做成完整框架
- 现有平台已经有 workspace open/close、watcher、resolve/compile 这些固定流程

但这个缺口必须被显式记录。后续如果某个 plugin 需要在 codoc 变更时响应，应该补一套明确的 lifecycle API，而不是绕过宿主直接监听文件系统。

## 运行时装配

### 启动时

`http-server.ts` 仍然是 composition root，但装配方式从“硬编码 RSS”变成“解析 active plugin 并装配”。

建议流程：

1. 读取 `codoc.config.json`
2. 解析 `workspaceKind`
3. 从 `pluginRegistry` 获取 plugin
4. 调用 `plugin.parseConfig(config.pluginConfig)`，得到类型化配置
5. 组装 source provider registry
6. `loadWorkspace(...)`
7. 创建 `WorkspacePluginContext<C>`
8. 挂载 plugin API routes
9. 创建 MCP server，并调用 `registerMcpTools`
10. 启动 plugin-specific jobs

### agent instructions 合并顺序

本地 chat provider 的 system prompt 建议按下面顺序组装：

1. base system prompt
2. `plugin.getAgentInstructions(ctx)`
3. legacy `codoc.config.json.agentInstructions`

也就是说：

- plugin prompt 优先
- legacy `agentInstructions` 作为用户补充文本拼接在后面
- 不做 override，避免用户已有配置被静默吞掉

### source provider registry

当前 `createSourceRegistry()` 返回内建 providers。建议改成：

```ts
export function createSourceRegistry(
  extraProviders: readonly SourceProvider[] = [],
): SourceRegistry
```

或者更直接，在 `apps/local` 组装：

```ts
const providers = [
  httpJsonProvider,
  rssProvider,
  ...plugin.sourceProviders?.() ?? [],
];
```

推荐后者。原因是 provider 的 composition root 本来就应该在 app 层，不必把 plugin 概念再反向灌进 parser 包。

### 平台 source scheduler

当前 [apps/local/src/rss-scheduler.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/rss-scheduler.ts:1) 建议保留为平台能力，并在后续重命名为 `source-scheduler.ts`。

它的职责是：

- 扫描所有 periodic `$source`
- 调用对应 provider 刷新缓存
- 统一写回 `.source-state.json`

它不属于 RSS plugin。

RSS plugin 最多只会：

- 依赖它刷新 feed articles
- 在其之上增加 RSS-specific orchestration

### REST 路由挂载

当前 `createApiRoutes()` 是一个大一统文件，并且已经出现了 RSS 专属 patch 路径。

建议拆为：

- 平台通用路由：`/api/tree`、`/api/codocs`、`/api/codoc/*`
- plugin 路由：`/api/plugins/rss/*` 或 `/api/rss/*`

推荐路径：

```text
/api/plugins/rss/subscriptions
/api/plugins/rss/refresh
/api/plugins/rss/digest
/api/plugins/rss/articles/:articleId/read
```

这样：

- 平台 API 保持稳定
- RSS 不再继续污染 `api-routes.ts`
- 后续 bookmarks / review 也可以走同样模式

### MCP tools 挂载

当前 `createMcpServer()` 全部工具都在一个文件里硬编码注册。

建议保留：

- 通用 codoc tools 继续在共享 MCP server 里注册

新增：

- plugin 可以通过 `registerMcpTools()` 注入自己的高层工具

这样 RSS agent 将优先调用：

- `rss_list_subscriptions`
- `rss_subscribe`
- `rss_refresh`
- `rss_generate_digest`
- `rss_mark_read`
- `rss_toggle_star`
- `rss_summarize_article`

而不是一上来就拼 `write_codoc` / `update_data_field`。

## 配置设计

### 新配置格式

建议把 `codoc.config.json` 逐步收敛成下面的形态：

```json
{
  "port": 4321,
  "workspaceKind": "rss",
  "pluginConfig": {
    "defaultSourceIntervalMinutes": 30,
    "digestCodocPath": "inbox.codoc",
    "sourcesDir": "sources"
  }
}
```

### 字段分层原则

建议把配置字段严格拆成两层。

#### root config

放宿主 / 平台级字段：

- `port`
- `workspaceKind`

这些字段的特点是：

- 与具体 plugin 无关
- 宿主在激活 plugin 之前就需要读取
- 更换 plugin 后语义仍保持不变

#### `pluginConfig`

放某个 plugin 自己拥有的领域字段。

RSS 例子：

- `defaultSourceIntervalMinutes`
- `digestCodocPath`
- `sourcesDir`

未来 bookmarks 例子可能会是：

- `readingListPath`
- `defaultTags`
- `archiveDir`

原则上，凡是字段名只对某个 `workspaceKind` 有意义，就不应该放在 root config。

### RSS interval 配置约束

RSS plugin 需要特别避免“双入口配置”。

当前平台 source scheduler 的事实来源是每个 `$source` 字段自己的 `interval`：

- 调度时读取 codoc 里的 `$source.interval`
- 不读取 workspace 级 config 来覆盖它

因此：

- `pluginConfig.defaultSourceIntervalMinutes` 只是“创建新订阅 codoc 时写入的默认 interval”
- 它不是 runtime override
- 如果某个 source codoc 已经显式声明了 `interval`，则以该声明为准

优先级规则：

1. 运行时调度永远以每个 `$source.interval` 为准
2. `pluginConfig.defaultSourceIntervalMinutes` 只在“创建新 feed / scaffold 新 source codoc”时生效

如果未来不需要 workspace 级默认值，这个字段也可以直接删除，只保留 `$source.interval` 一个入口。

### 兼容旧字段

当前字段：

- `commands`
- `quickActions`
- `agentInstructions`

第一版保留兼容，但 RSS plugin 不再依赖这些字段驱动产品能力。

处理策略：

- 旧 workspace 仍可读取这些字段
- RSS plugin 的 domain action 和系统提示改由 plugin runtime 输出
- 文档中标记这三类字段为 legacy interaction hints
- 新代码不应再把它们当作主能力声明入口

### Legacy workspace 检测

为了兼容已经存在的 RSS workspace，建议 `WorkspacePlugin` 提供 `detectWorkspace()`。

RSS 的识别条件可以是：

- 根目录存在 `inbox.codoc`
- 存在 `sources/*.codoc`
- 至少一个 codoc 含 `$source: rss`

处理策略：

1. 如果 `workspaceKind` 已存在，直接信任配置
2. 如果不存在，按内建 plugin 顺序尝试 `detectWorkspace()`
3. 如果零匹配，fallback 到 `default` plugin
4. 如果恰好一个匹配，则以内存方式激活该 plugin
5. 如果多匹配，记录 warning，并 fallback 到 `default` plugin
6. 可选地把识别结果回写到 `codoc.config.json`

这样用户现有 RSS workspace 不需要手工迁移。

## RSS Plugin 设计

## 定位

RSS plugin 是一个“工作区产品单元”，不是单个 source provider。

它拥有：

- RSS template
- RSS source handling
- article state mutation
- digest generation orchestration
- feed subscription management
- Inbox-first UI descriptor

它**不**拥有平台级 periodic source scheduler。

## RSS Plugin 目录建议

```text
apps/local/src/plugins/rss/
  AGENTS.md
  index.ts
  template.ts
  config.ts
  detect.ts
  service.ts
  api-routes.ts
  mcp-tools.ts
  jobs.ts
  ui.ts
```

### 各文件职责

#### `template.ts`

从现有 [apps/local/src/templates/rss.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/templates/rss.ts:1) 迁出。

负责：

- scaffold `inbox.codoc`
- scaffold `sources/*.codoc`
- scaffold `guide.codoc`
- 安装 `ArticleList` / `FeedHeader`

同时在 `buildConfig` 时写入：

- `workspaceKind: "rss"`
- `pluginConfig` 默认值

#### `service.ts`

RSS 领域服务，建议先落在 app 层，不急着抽 package。

建议暴露：

- `listSubscriptions`
- `subscribeFeed`
- `unsubscribeFeed`
- `refreshSubscriptions`
- `generateDigest`
- `markArticleRead`
- `toggleArticleStar`
- `summarizeArticle`

注意这里是产品级动作，不是底层 codoc patch helper。

#### `api-routes.ts`

提供本地 UI 的显式动作接口，例如：

- `GET /api/plugins/rss/subscriptions`
- `POST /api/plugins/rss/subscriptions`
- `DELETE /api/plugins/rss/subscriptions/:feedId`
- `POST /api/plugins/rss/refresh`
- `POST /api/plugins/rss/digest`
- `POST /api/plugins/rss/articles/:articleId/read`
- `POST /api/plugins/rss/articles/:articleId/star`

这会替换当前散落在通用路由里的 RSS 专属逻辑。

#### `mcp-tools.ts`

把上述领域动作暴露成 MCP tools。

关键点：

- tool 名字以 `rss_` 前缀命名，避免和平台通用工具冲突
- 对 agent 暴露的是高层语义，不是底层文件修改动作

#### `jobs.ts`

这个文件只承载 RSS-specific background jobs。

例如未来可能出现：

- 定时预生成 digest
- 对长期未刷新的 feed 做健康提示
- 定期清理过旧的 digest codoc

它**不**接管当前通用 source scheduler。现有 [apps/local/src/rss-scheduler.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/rss-scheduler.ts:1) 应保留为平台能力，并在后续重命名为 `source-scheduler.ts` 更准确。

#### `ui.ts`

先不做 React 组件注入，只做 UI descriptor：

```ts
{
  homeView: "inbox",
  hiddenPaths: ["guide.codoc"],
  primaryActions: [
    {
      kind: "rest",
      id: "refresh",
      label: "Refresh feeds",
      method: "POST",
      path: "/api/plugins/rss/refresh"
    },
    {
      kind: "rest",
      id: "digest",
      label: "Update digest",
      method: "POST",
      path: "/api/plugins/rss/digest"
    },
    {
      kind: "chat-prompt",
      id: "subscribe",
      label: "Subscribe",
      prompt: "Subscribe to "
    }
  ]
}
```

这样本地 UI 可以在不支持动态 plugin 组件的前提下，先获得 domain-aware 行为。

## RSS Plugin 落地方案

推荐按四期落地，每一期都保持系统可运行。

### 第 0 期：引入 plugin 壳，不改行为

目标：先把边界搭出来。

改动：

- 新增 `apps/local/src/plugins/types.ts`
- 新增 `apps/local/src/plugins/registry.ts`
- 新增 `default` plugin
- `templates/index.ts` 仍保留，但开始让 template 能映射到 plugin
- 明确平台层保留通用 source scheduler，不进入任何 vertical plugin

结果：

- 系统知道“workspace 可以有 kind”
- 但 RSS 行为暂时还是旧实现

### 第 1 期：把 RSS ownership 收进 plugin

目标：停止 RSS 继续污染主流程。

改动：

- 把 RSS template 移到 `plugins/rss/template.ts`
- 把 RSS article patch route 移到 `plugins/rss/api-routes.ts`
- 平台层把 `rss-scheduler.ts` 重命名为 `source-scheduler.ts`
- 把 `workspaceKind: "rss"` 写入新建 workspace config
- `http-server.ts` 打开工作区时激活 RSS plugin

结果：

- RSS runtime owner 从全局文件变成 `plugins/rss`
- 即便还没有新 MCP tools，也已经切开主流程边界
- 通用 periodic source runtime 继续由平台拥有

### 第 2 期：提供 RSS 领域 API 和 MCP tools

目标：RSS agent 和 UI 都不再主要依赖通用 codoc 工具。

新增领域动作：

- `rss_list_subscriptions`
- `rss_subscribe`
- `rss_unsubscribe`
- `rss_refresh`
- `rss_generate_digest`
- `rss_mark_read`
- `rss_toggle_star`
- `rss_summarize_article`

同时保留通用 codoc tools 作为 fallback，不强制删掉。

结果：

- RSS 体验从“文档操作”提升为“产品动作”
- 以后换 agent、换 prompt，也不会影响核心 RSS 交互

### 第 3 期：Inbox-first UI

目标：用户打开 RSS workspace 就能消费，不必先理解文件树。

改动：

- UI 读取 `plugin.getUiSpec()`
- RSS workspace 默认落在 Inbox
- 把 Refresh / Digest / Subscribe 变成显式按钮
- 把 sources 降级为次要导航

结果：

- RSS workspace 从 codoc demo 变成 RSS 产品

## 需要改动的现有文件

下面列出第一版最关键的改动点。

### `apps/local/src/init.ts`

当前 `buildConfig(template)` 只写：

- `commands`
- `quickActions`
- `agentInstructions`

需要改成：

- 支持 `workspaceKind`
- 支持 `pluginConfig`
- template 从 plugin 读取默认配置
- legacy `commands` / `quickActions` / `agentInstructions` 仅作为兼容字段继续写入

### `apps/local/src/http-server.ts`

这是核心 composition root，需要改成 plugin-aware：

- 打开 workspace 时读取 `workspaceKind`
- 通过 registry 激活 plugin
- 零匹配 / 多匹配时 fallback 到 `default`
- 调用 `plugin.parseConfig()` 得到类型化配置
- 组装 plugin source providers
- 挂载 plugin API
- 给 MCP server 追加 plugin tools
- 启动/停止 plugin-specific jobs
- 平台继续启动/停止通用 source scheduler

### `apps/local/src/api-routes.ts`

需要把 RSS 专属文章 patch 逻辑迁走，恢复成平台通用路由层。

原则：

- 共享的保留
- RSS 专属的下沉到 `plugins/rss/api-routes.ts`

### `apps/local/src/mcp-server.ts`

需要提供扩展点：

```ts
plugin?.registerMcpTools(server, ctx)
```

保留通用工具注册不变，RSS 领域工具在插件里追加。

### `apps/local/src/templates/index.ts`

第一版可以保留，但建议改成从 plugin registry 导出 template 列表，而不是自己维护另一套并行 registry。

### `packages/parser/src/registry.ts`

不建议把 plugin 感知塞进 parser。

更好的做法是：

- parser 保持纯 provider port
- app 层自行组装最终 registry

### `apps/local/src/rss-scheduler.ts`

建议在 platform 层保留，但尽快重命名为 `source-scheduler.ts`，避免继续误导后续设计。

## 关于 RSS source provider 的归属

RSS provider 现在在 [packages/parser/src/rss.ts](/Users/kxzhang/code/local-tool/codoc/packages/parser/src/rss.ts:1)。

第一版可以保持不动，不必为了 plugin 立刻迁走。

原因：

- 它本质是通用 `SourceProvider`
- 它不拥有 RSS 产品流程
- 它被 RSS plugin 使用，并不等于它属于 RSS plugin

也就是说：

- `rssProvider` 可以继续留在 parser 层
- RSS 的“订阅、刷新、digest、UI、MCP tools” 属于 RSS plugin

这是合理分层。

## 为什么不直接做动态插件系统

如果现在直接做动态 plugin，会额外引入这些问题：

- 插件发现与加载位置
- 版本兼容与升级
- API / MCP / scheduler 权限边界
- UI 组件注入安全性
- workspace 配置迁移

这些都是真问题，但它们和“RSS 不该污染主流程”不是一个层级。

当前最该先解决的是边界收敛，不是生态开放。

所以第一版最合理的路线是：

- 内建 plugin registry
- 编译期注册
- 单 workspace 单 plugin
- 稳定后再讨论动态化

## 最终建议

建议按下面的原则推进：

1. 先上 `WorkspacePlugin`，不要继续在全局文件里长 RSS 分支。
2. 第一版只做内建、编译期注册的 plugin，不做动态插件。
3. 一 个 workspace 先只允许一个 `workspaceKind`。
4. RSS template、API、MCP、UI descriptor 收进 `plugins/rss/`，但通用 source scheduler 留在平台层。
5. 通用 codoc 能力继续保留，但 RSS 高频交互升级成高层领域动作。

如果这个设计落地成功，接下来 bookmarks 只需要再跑一遍同样的边界，就能验证这套 plugin 抽象是否稳定。

## 附：RSS Plugin 最小落地清单

第一轮最小可落地，不求一步到位：

- 新增 `apps/local/src/plugins/types.ts`
- 新增 `apps/local/src/plugins/registry.ts`
- 新增 `apps/local/src/plugins/rss/index.ts`
- 新增 `apps/local/src/plugins/rss/template.ts`
- 新增 `apps/local/src/plugins/rss/api-routes.ts`
- 可选新增 `apps/local/src/plugins/rss/jobs.ts`（仅当确有 RSS-specific background job）
- `init.ts` 写入 `workspaceKind: "rss"`
- `http-server.ts` 按 `workspaceKind` 激活 plugin
- `http-server.ts` 调用 `plugin.parseConfig()`
- `mcp-server.ts` 增加 plugin tool 注册钩子
- `rss-scheduler.ts` 保留在平台层并重命名为 `source-scheduler.ts`
- `api-routes.ts` 删除 RSS 专属 patch 路由，迁入 RSS plugin

做到这里，RSS 就已经从“主流程里的特殊 case”变成“边界清晰的 workspace plugin”了。
