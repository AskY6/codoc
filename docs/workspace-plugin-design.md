# Workspace Plugin 设计

## 背景

当前 `apps/local` 已经有几类扩展点，但它们彼此是分散的：

- `templates/` 负责初始化工作区骨架
- `@cobook/parser` 的 `SourceProvider` 负责 `$source`
- `providers/` 负责外部 CLI chat backend
- `api-routes.ts` 和 `mcp-server.ts` 暴露本地 HTTP API 与 MCP tools
- `rss-scheduler.ts` 负责周期刷新

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
- background jobs
- UI 导航与 domain action
- chat/system prompt 贡献

也就是说，RSS 不应该继续表现为“一个模板”，而应该是“一个工作区种类”。

### 4. 第一版采用编译期注册，不做动态加载

`WorkspacePlugin` 第一版直接内建在仓库里，通过 registry 注册：

- 简单
- 可测试
- 不引入模块发现、签名、权限、版本兼容问题

等接口稳定后，再考虑动态 plugin。

## 总体模型

### 核心概念

#### `WorkspacePlugin`

一个垂直工作区能力包。

它可以贡献：

- workspace template
- source providers
- API routes
- MCP tools
- background jobs
- chat contribution
- UI descriptor

#### `workspaceKind`

工作区绑定的 plugin id，例如：

- `default`
- `rss`
- `bookmarks`

#### `pluginConfig`

plugin 自己拥有的一段 opaque 配置，挂在 `codoc.config.json` 里：

```json
{
  "port": 4321,
  "workspaceKind": "rss",
  "pluginConfig": {
    "refreshIntervalMinutes": 30,
    "digestCodocPath": "inbox.codoc",
    "sourcesDir": "sources"
  }
}
```

根配置保留平台级字段，plugin 细节进入 `pluginConfig`，避免全局字段名不断膨胀。

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

export interface WorkspaceConfigFile {
  port?: number;
  workspaceKind?: string;
  pluginConfig?: Record<string, unknown>;

  // legacy compatibility
  commands?: Array<{ name: string; description: string; prompt: string }>;
  quickActions?: Array<{ label: string; prompt: string }>;
  agentInstructions?: string;
}

export interface WorkspacePluginContext {
  readonly workspaceName: string;
  readonly workspace: Workspace;
  readonly config: WorkspaceConfigFile;
  readonly pluginConfig: Record<string, unknown>;
  readonly updates: EventEmitter;
  readonly providerRegistry: ProviderRegistry;
}

export interface PluginJobHandle {
  readonly ready?: Promise<void>;
  stop(): void;
}

export interface WorkspaceUiSpec {
  readonly homeView?: "tree" | "inbox";
  readonly hiddenPaths?: readonly string[];
  readonly primaryActions?: readonly Array<{
    id: string;
    label: string;
    action: string;
  }>;
}

export interface WorkspacePlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  // optional legacy workspace detection
  detectWorkspace?(workspace: Workspace, config: WorkspaceConfigFile): boolean;

  // optional scaffold template for `codoc init --from`
  readonly template?: Template;

  // plugin-owned config defaults / normalization
  normalizeConfig?(
    config: WorkspaceConfigFile,
  ): WorkspaceConfigFile;

  // source providers contributed by this plugin
  sourceProviders?(): readonly SourceProvider[];

  // REST routes mounted under /api/plugins/<plugin-id> or /api/<plugin-prefix>
  createApiRoutes?(ctx: WorkspacePluginContext): Hono;

  // extra MCP tools appended to the shared MCP server
  registerMcpTools?(server: McpServer, ctx: WorkspacePluginContext): void;

  // background jobs started on workspace open and stopped on close
  startJobs?(ctx: WorkspacePluginContext): readonly PluginJobHandle[];

  // extra system prompt contribution for local chat providers
  getAgentInstructions?(ctx: WorkspacePluginContext): string | undefined;

  // UI hints for local SPA
  getUiSpec?(ctx: WorkspacePluginContext): WorkspaceUiSpec;
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

#### `startJobs()` 独立于 plugin 自身生命周期

像 RSS refresh scheduler 这种能力，本质上是 workspace-open 时启动、workspace-close 时停止的 job，不应该继续作为全局逻辑留在 `http-server.ts`。

## 运行时装配

### 启动时

`http-server.ts` 仍然是 composition root，但装配方式从“硬编码 RSS”变成“解析 active plugin 并装配”。

建议流程：

1. 读取 `codoc.config.json`
2. 解析 `workspaceKind`
3. 从 `pluginRegistry` 获取 plugin
4. 组装 source provider registry
5. `loadWorkspace(...)`
6. 创建 `WorkspacePluginContext`
7. 挂载 plugin API routes
8. 创建 MCP server，并调用 `registerMcpTools`
9. 启动 plugin jobs

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
    "refreshIntervalMinutes": 30,
    "digestCodocPath": "inbox.codoc",
    "sourcesDir": "sources"
  }
}
```

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

### Legacy workspace 检测

为了兼容已经存在的 RSS workspace，建议 `WorkspacePlugin` 提供 `detectWorkspace()`。

RSS 的识别条件可以是：

- 根目录存在 `inbox.codoc`
- 存在 `sources/*.codoc`
- 至少一个 codoc 含 `$source: rss`

处理策略：

1. 如果 `workspaceKind` 已存在，直接信任配置
2. 如果不存在，按内建 plugin 顺序尝试 `detectWorkspace()`
3. 如果恰好一个匹配，则以内存方式激活该 plugin
4. 可选地把识别结果回写到 `codoc.config.json`

这样用户现有 RSS workspace 不需要手工迁移。

## RSS Plugin 设计

## 定位

RSS plugin 是一个“工作区产品单元”，不是单个 source provider。

它拥有：

- RSS template
- RSS source handling
- feed refresh job
- article state mutation
- digest generation orchestration
- feed subscription management
- Inbox-first UI descriptor

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

接管当前 [apps/local/src/rss-scheduler.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/rss-scheduler.ts:1) 的职责。

建议把现有 scheduler 逻辑迁入 plugin，并改成 `startJobs()` 返回的 handle。

#### `ui.ts`

先不做 React 组件注入，只做 UI descriptor：

```ts
{
  homeView: "inbox",
  hiddenPaths: ["guide.codoc"],
  primaryActions: [
    { id: "refresh", label: "Refresh feeds", action: "rss.refresh" },
    { id: "digest", label: "Update digest", action: "rss.digest" },
    { id: "subscribe", label: "Subscribe", action: "rss.subscribe" }
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

结果：

- 系统知道“workspace 可以有 kind”
- 但 RSS 行为暂时还是旧实现

### 第 1 期：把 RSS ownership 收进 plugin

目标：停止 RSS 继续污染主流程。

改动：

- 把 RSS template 移到 `plugins/rss/template.ts`
- 把 RSS article patch route 移到 `plugins/rss/api-routes.ts`
- 把 RSS scheduler 移到 `plugins/rss/jobs.ts`
- 把 `workspaceKind: "rss"` 写入新建 workspace config
- `http-server.ts` 打开工作区时激活 RSS plugin

结果：

- RSS runtime owner 从全局文件变成 `plugins/rss`
- 即便还没有新 MCP tools，也已经切开主流程边界

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

### `apps/local/src/http-server.ts`

这是核心 composition root，需要改成 plugin-aware：

- 打开 workspace 时读取 `workspaceKind`
- 通过 registry 激活 plugin
- 组装 plugin source providers
- 挂载 plugin API
- 给 MCP server 追加 plugin tools
- 启动/停止 plugin jobs

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
4. RSS template、API、MCP、scheduler、UI descriptor 全部收进 `plugins/rss/`。
5. 通用 codoc 能力继续保留，但 RSS 高频交互升级成高层领域动作。

如果这个设计落地成功，接下来 bookmarks 只需要再跑一遍同样的边界，就能验证这套 plugin 抽象是否稳定。

## 附：RSS Plugin 最小落地清单

第一轮最小可落地，不求一步到位：

- 新增 `apps/local/src/plugins/types.ts`
- 新增 `apps/local/src/plugins/registry.ts`
- 新增 `apps/local/src/plugins/rss/index.ts`
- 新增 `apps/local/src/plugins/rss/template.ts`
- 新增 `apps/local/src/plugins/rss/api-routes.ts`
- 新增 `apps/local/src/plugins/rss/jobs.ts`
- `init.ts` 写入 `workspaceKind: "rss"`
- `http-server.ts` 按 `workspaceKind` 激活 plugin
- `mcp-server.ts` 增加 plugin tool 注册钩子
- `api-routes.ts` 删除 RSS 专属 patch 路由，迁入 RSS plugin

做到这里，RSS 就已经从“主流程里的特殊 case”变成“边界清晰的 workspace plugin”了。
