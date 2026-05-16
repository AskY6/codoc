# Plugin Architecture v2 — 向 VS Code 模型演化

## 状态

- **当前文档定位**：v2 设计 / 路线图，规划阶段
- **历史背景**：v1 `WorkspacePlugin` 接口与 Phase 0 host delta（`homeCodocPath` / `plugin-views/` 目录 / agent wiring 修复）均已落地，本文档的 Phase 2 把它们收编为 manifest + activate
- **保持有效**：`rss-product-roadmap.md`、`knowledge-workspace-plan.md`、`language-workspace-plan.md` 的产品诉求，本文档不改产品方向，只改承载它们的 plugin 框架

## 1. 背景与问题

v1 `WorkspacePlugin`（`apps/local/src/plugins/types.ts`）已经把 RSS 这类 vertical 从主流程解耦，但随着规划扩张（knowledge / language / 多个 vertical），现框架出现两个结构性问题：

### 1.1 一个 plugin 物理上散在 4 个目录

以 RSS 为例：

| 内容 | 当前位置 |
| --- | --- |
| Server runtime（fetch / ranking / digest / api-routes / mcp tools） | `apps/local/src/plugins/rss/` |
| SPA 面板（Subscriptions / Saved） | `apps/local/ui/src/plugin-views/rss/` |
| 内置 MDX 组件（ArticleList / DigestList / ...） | `apps/local/src/templates/rss/components/` |
| 工作区 scaffold | `apps/local/src/templates/rss.ts` |

`plugin-views/registry.ts` 用静态 TS import 把 UI 拼回来；用户视角看不出"这是 RSS plugin 的一部分"。

### 1.2 `WorkspacePlugin` 接口在堆字段

当前 8 个 hook（`detectWorkspace` / `template` / `parseConfig` / `sourceProviders` / `createApiRoutes` / `registerMcpTools` / `startJobs` / `getAgentInstructions` / `getUiSpec`），下一个 vertical 想加新维度（命令、键位、配置 schema）就得再扩接口。声明式的部分（UI 描述）和程序式的部分（routes / jobs）混在同一个 interface，没有 manifest 与 activate 的分层。

### 1.3 Domain 层不可见

`apps/local/src/workspace/` 同时承载纯定义（`resolve.ts` / `diagnose.ts` / `recognize.ts` / `patch.ts`）和运行时基础设施（`watcher.ts` 用 chokidar、`components.ts` 用 esbuild、`service.ts` 是 mutation loop）。目录名 `workspace` 把这两类东西模糊在一起，"domain 在哪"成了非显然问题。

### 1.4 SourceProvider 的归属反了

排查启动闭环时发现一个更深的问题。当前现状：

- `WorkspacePlugin.sourceProviders?()` hook 在 `apps/local/src/plugins/types.ts:125` 是声明的
- 整个 codebase **没有任何 plugin 实现它**，host 也**从来不调它**——dead code
- `rssProvider` 实际住在 `@cobook/parser` 的 `packages/parser/src/rss.ts:11`，由 `createSourceRegistry()` 无条件返回（`packages/parser/src/registry.ts:8-13`）
- RSS plugin 的 AGENTS.md 自己写明 `Does NOT own: rssProvider (parser layer)`

这意味着 `@cobook/parser`——本应是"纯 codoc 格式抽象"——内置了具体 domain scheme 的解析逻辑（RSS / Atom XML）。未来加 Gmail / Notion / HackerNews 等垂直时，要么继续往 parser 塞（parser 不再 generic），要么找别的地方安放。

与 VS Code 模型对照：VS Code 让 extension 贡献 languages / debuggers，不让 core 内置具体语言。我们现在是反过来——core 内置了 RSS scheme。v2 把 `rssProvider` 物理迁回 RSS plugin 自身，让"scheme 跟着 vertical 走"。这就是 §3.1 static contributions 真正的载荷需求来源——provider 必须在 `loadWorkspace` 之前注册，否则首轮 `resolveAll` 找不到 handler。

`httpJsonProvider` 保留在 parser：它是 generic（任意 HTTP JSON endpoint），不绑 vertical。parser 留作"真正通用的标准库"，去除 domain 特定的内容。

## 2. 目标

向 VS Code 的 extension 模型对齐，**保留第三方分发潜力但 v1 不实现**。

具体目标：

1. **一个 plugin = 一个目录**：server、ui、components、template、manifest 在同一棵子树
2. **声明式 `contributes` + 程序式 `activate(ctx)` 分层**：host 启动只读 manifest 就能渲染骨架，激活后由 plugin 注册 handler
3. **Commands 成为一等公民**：所有 plugin 交互都抽成命令，UI 控件、菜单、命令面板、键位都引用命令 id
4. **Domain / Runtime 显式分离**：domain 层（纯）和 runtime 层（副作用）独立目录
5. **保留潜力**：manifest schema、`engines.codoc` 兼容字段、scope 概念预留，但第三方动态加载 v1 不实现

非目标（v1 不做）：

- 第三方独立发包 / 跨进程 Extension Host
- 命令的 `when` 表达式语言
- 完整 activationEvents 懒加载（先按 workspaceKind eager 激活）
- Permission scope 协商
- 一个 workspace 同时启用多个 plugin（沿用 v1 单 plugin 约束）

## 3. 生命周期与贡献分层

不是所有贡献都能等到 `activate(ctx)` 才注册。host 在能调用 `activate` 之前就已经必须知道某些事情：怎么解析 `$source: rss`、当前 workspace 该被哪个 plugin 接管、`codoc init --from rss` 该生成什么文件。这些必须落到一个 **pre-activation 层**，否则会形成启动闭环。

按 host 启动顺序，plugin 的贡献分三层：

### 3.1 Static contributions —— host 启动时即装载

通过 manifest 中的 **entry pointer** 字段静态指向 plugin 内某个模块；host 在加载 workspace **之前**就 import 这些模块，把里面导出的对象注册到全局 registry。这一层不接受 workspace / pluginConfig，是"无 ctx"的纯函数 / 纯对象。

属于这一层的贡献：

- **`sourceProviders`**：`{ scheme, entry: "server/sources.ts#rssProvider" }`。host import 后注册到全局 `SourceRegistry`。**必须在 `loadWorkspace` 之前完成**——否则 `apps/local/src/workspace/index.ts:42` 调到的 `resolveAll` 在第 61 行就跑 `resolveDataFields` 时找不到 provider。
  - 当前 `rssProvider` 在 parser 层（§1.4），这一字段在 v1 是 dead；v2 把 provider 物理迁回 plugin，**这才是 pre-activation 阶段唯一真正 load-bearing 的贡献**。其它三项即使不前置也能跑，只是放前面让模型对称。
  - 注册是**全局**的，不绑 workspace。即使当前打开的 workspace 不是 RSS workspace，RSS plugin 的 provider 也已注册——provider 只在 `$source: <scheme>` 出现时才被实际调用，没有副作用。
- **`templates`**：`{ id, name, description, entry: "template/index.ts" }`。entry 导出当前 `Template` 接口（`files()`、`components[]`、`agentInstructions`）。host 在 `codoc init --from <id>` 时静态 import 并执行，沿用 `apps/local/src/commands/init.ts` 现有路径。当前流程已经是这种形态（`templates/index.ts` 静态聚合），改动只是把 import 源换成 manifest entry pointer。
- **`legacyDetect`**（可选）：`{ entry: "server/detect.ts#detectRssWorkspace" }`。host 加载完 workspace 后、激活前，对每个 plugin 跑一遍它的 detect 函数（输入 `Workspace`、输出 boolean）。这是程序化的，因为 RSS 现在的判定要遍历 AST 字段（`apps/local/src/plugins/rss/detect.ts:21-23`），declarative hint 表达不了。**注意**：detect 是 post-load 但 pre-activate 的——name 里的"static"指"不绑 ctx"，不是"在 load 之前"。
- **`configurationSchema`**：JSON Schema 字面量，host ajv 校验后产生 typed `pluginConfig` 喂给 `activate(ctx)`。

> v1 关于"declarative 还是 entry pointer"的判据：能用字面量表达（schema、id/label/icon、文件名清单）就 declarative；需要跑代码（AST 遍历、文件生成、provider 工厂）就 entry pointer。**别为了形式去发明 DSL。**

### 3.2 Per-workspace activation —— `activate(ctx)`，workspace 加载完成后调用

这一层依赖具体 workspace 与 typed config。host 在以下顺序完成后才调 `activate(ctx)`：

1. Static contributions 已 import 并注册（含 source providers）
2. `loadWorkspace` 完成（含首次 `resolveAll`、`compileAll`）
3. Plugin 已通过 `workspaceKind` 或 `legacyDetect` 确定
4. `pluginConfig` 已用 manifest schema 校验

属于这一层的贡献：commands、routes、MCP tools、background jobs、agent instructions、SSE 推送、订阅 workspace 事件等。

### 3.3 UI contributions —— `activateUi(ctx)`，浏览器加载 SPA 后调用

views、mdx components、UI 命令。运行在浏览器，host 通过 plugin UI bundle 暴露。

## 4. 终态

### 4.1 目录布局

```
apps/local/
├── src/
│   ├── domain/             # 纯：Workspace 类型、resolve/diagnose/recognize/patch/load
│   ├── runtime/            # 副作用：service mutation loop, watcher, esbuild components
│   ├── server/             # HTTP / MCP / SSE — 不再 import plugin 具体实现
│   ├── plugins-host/       # host 侧 plugin runtime（manifest 解析、activate、Disposable 管理、命令总线）
│   ├── providers/          # 不变
│   ├── commands/           # CLI 子命令（与 plugin commands 解耦命名，不重命名）
│   ├── sources/            # 不变
│   └── index.ts
├── plugins/
│   ├── rss/
│   │   ├── manifest.json   # contributes
│   │   ├── server/
│   │   │   ├── index.ts    # export activate(ctx)
│   │   │   ├── digest-job.ts
│   │   │   ├── article-fetch.ts
│   │   │   ├── ranking.ts
│   │   │   ├── subscription.ts
│   │   │   ├── ai-summary.ts
│   │   │   └── api-routes.ts
│   │   ├── ui/
│   │   │   ├── index.ts    # export activateUi(ctx)
│   │   │   └── panels/{SubscriptionsPanel,SavedArticlesPanel}.tsx
│   │   ├── components/     # plugin-shipped MDX 组件
│   │   │   ├── ArticleList.tsx
│   │   │   ├── DigestList.tsx
│   │   │   └── ...
│   │   └── template/
│   │       ├── index.ts    # 仅 metadata + 文件清单
│   │       └── assets/     # init 时拷贝到 ~/.codoc/<workspace>/ 的文件
│   └── default/            # 同结构，no-op 实现
├── ui/
│   ├── src/                # SPA shell：FileTree / ChatPanel / DocumentPanel / MDX render / 命令总线
│   └── vite.config.ts      # 扫 plugins/*/ui/index.ts 做静态注册
└── tsup.config.ts          # 扫 plugins/*/server/index.ts，打入主 bundle 的 plugin registry
```

### 4.2 Manifest schema

字段按 §3 的生命周期分组。**static** 字段在 host 加载 workspace 前消费；**activation** 字段是 manifest declarative 部分，host 在 activate 时把它喂回 ctx；**ui** 字段供 SPA 直接消费。

`entry` 字段用 `"<path>"` 或 `"<path>#<export>"` 语法指向 plugin 内某模块。v1 全部在编译期 import；保留指针写法是为未来动态加载留接口。

```jsonc
{
  "id": "rss",
  "name": "RSS Reader",
  "description": "AI-first RSS — digests, deep dives, and research across feeds.",
  "engines": { "codoc": "^0.x" },
  "activationEvents": ["onWorkspaceKind:rss"],

  "contributes": {
    // ---- Static (loaded before workspace) ---------------------------------
    "sourceProviders": [
      { "scheme": "rss", "entry": "server/sources.ts#rssProvider" }
    ],
    "templates": [
      {
        "id": "rss",
        "name": "RSS Reader",
        "description": "AI-first RSS reading + digest workspace.",
        "entry": "template/index.ts"
      }
    ],
    "legacyDetect": { "entry": "server/detect.ts#detectRssWorkspace" },
    "configurationSchema": { /* JSON Schema for pluginConfig */ },
    "agentInstructions": "assets/agent-prompt.md",

    // ---- Activation (declarative half; programmatic half in activate(ctx)) -
    "commands": [
      { "id": "rss.refresh",   "title": "Refresh feeds" },
      { "id": "rss.digest",    "title": "Update digest" },
      { "id": "rss.subscribe", "title": "Subscribe..." }
    ],
    "menus": {
      "workspace.actionBar": [
        { "command": "rss.refresh" },
        { "command": "rss.digest" },
        { "command": "rss.subscribe" }
      ],
      "view.title":     [{ "view": "rss.subscriptions", "command": "rss.addSub" }],
      "commandPalette": [{ "command": "rss.refresh" }, { "command": "rss.digest" }]
    },
    "mcpTools": [
      { "name": "rss.subscribe", "description": "...", "inputSchema": { /* JSON Schema */ } }
    ],

    // ---- UI ---------------------------------------------------------------
    "views": [
      { "id": "rss.subscriptions", "label": "Subscriptions", "icon": "list" },
      { "id": "rss.saved",         "label": "Saved",         "icon": "bookmark" }
    ],
    "mdxComponents": [
      { "name": "ArticleList",   "path": "components/ArticleList.tsx" },
      { "name": "DigestList",    "path": "components/DigestList.tsx" }
    ],
    "ui": {
      "homeView": "inbox",
      "homeCodocPath": null,
      "hiddenPaths": ["guide.codoc"]
    }
  }
}
```

#### Template entry contract

`templates[i].entry` 必须导出符合下述形状的对象（沿用现有 `apps/local/src/templates/types.ts:27-44` 的 `Template`）：

```ts
export interface Template {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly components: readonly string[];          // catalog auto-install
  files(): readonly TemplateFile[];                // 生成的文件清单
  readonly commands?: readonly Command[];          // legacy slash 命令（迁移期保留）
  readonly quickActions?: readonly QuickAction[];  // legacy quick actions
  readonly agentInstructions?: string;             // 老路径，逐步迁到 manifest.agentInstructions
}
```

host 在 `codoc init --from <id>` 时：

1. 查 manifest `templates[]` 找到匹配 id
2. 静态 import `entry` 路径，取出 `Template` 对象
3. 执行 `tmpl.files()`，跑 `validateTemplateContent`（沿用 `apps/local/src/commands/init.ts:148-179`）
4. 逐文件 `writeIfMissing`
5. 对 `tmpl.components[]` 调 `addComponent`（catalog 自动安装）

v1 不试图把 `files()` 改成静态 JSON——RSS 模板里 `feeds.map(sourceCodoc)` 是程序化生成（`apps/local/src/templates/rss.ts:228`），强行静态化会损失表达力。模板就是有代码的；接受它。

#### SourceProvider entry contract

```ts
// server/sources.ts
import type { SourceProvider } from "@cobook/parser";
export const rssProvider: SourceProvider = { /* ... */ };
```

host 启动时按顺序：

1. 读所有 plugin manifest
2. 对每个 `contributes.sourceProviders[]`，import entry，把导出的 provider 注册进 global `SourceRegistry`
3. 这时才调 `loadWorkspace(sourceDir, outDir, sourceRegistry)`

注意：v1 仍是"一个 workspace 一个 plugin"，但 source providers 在 manifest 层就生效，意味着 host 即使没激活某 plugin（workspaceKind 不匹配），它的 source provider 也已注册到 registry。这不会有副作用——provider 只在 `$source: <scheme>` 出现时才被调用。换句话说 source provider 的注册是**全局**的，不绑 workspace。

#### LegacyDetect entry contract

```ts
// server/detect.ts
import type { Workspace, WorkspaceConfigFile } from "@cobook/local-host";
export function detectRssWorkspace(ws: Workspace, config: WorkspaceConfigFile): boolean;
```

host 在 workspace 加载完成、`workspaceKind` 未指定时，按 manifest 顺序调每个 plugin 的 `legacyDetect`，第一个返回 `true` 的胜出。逻辑等价于现 `apps/local/src/plugins/detect.ts` 的 `resolvePlugin`，只是 import 路径走 manifest entry 而非 plugin registry。

### 4.3 Server ActivateContext

`activate(ctx)` 在 workspace 已就绪后调用，**不**承担 source provider / template / legacy detect 注册（这些是 static contributions，见 §3.1）。

```ts
export function activate(ctx: ActivateContext<Config>): void | Promise<void>;

interface ActivateContext<C = unknown> {
  // Identity
  readonly workspaceName: string;
  readonly pluginId: string;

  // Typed config (host 已按 manifest.configurationSchema 校验)
  readonly config: C;

  // Codoc CRUD + events
  readonly workspace: {
    read(path: CodocPath): Promise<CodocDetail | null>;
    write(path: CodocPath, content: string): Promise<void>;
    updateField(path: CodocPath, field: string, value: unknown): Promise<void>;
    delete(path: CodocPath): Promise<void>;
    list(): readonly CodocPath[];
    onDidChange(handler: (e: CodocChangeEvent) => void): Disposable;
  };

  // MCP tools
  readonly mcp: {
    registerTool(name: string, handler: (args: unknown) => Promise<unknown>): Disposable;
  };

  // Commands (server-side handlers)
  readonly commands: {
    registerCommand(id: string, handler: (args?: unknown) => Promise<unknown>): Disposable;
    executeCommand(id: string, args?: unknown): Promise<unknown>;
  };

  // HTTP routes 子树 (mount 在 /api/plugins/<pluginId>)
  readonly routes: {
    use(router: Hono): Disposable;
  };

  // Background jobs
  readonly jobs: {
    start(name: string, fn: JobFn): Disposable;
  };

  // Chat / Provider registry
  readonly providers: { chat: ProviderRegistry };

  // SSE
  readonly updates: { emit(event: UpdateEvent): void };

  // Disposable bag — push 进去 deactivate 时自动释放
  readonly subscriptions: Disposable[];
}
```

### 4.4 UI ActivateContext

```ts
export function activateUi(ctx: UiActivateContext<Config>): void;

interface UiActivateContext<C = unknown> {
  readonly workspaceName: string;
  readonly pluginId: string;
  readonly config: C;

  readonly views: {
    registerView(id: string, component: React.ComponentType<ViewProps>): Disposable;
  };

  readonly mdxComponents: {
    register(name: string, component: React.ComponentType): Disposable;
  };

  readonly commands: {
    registerCommand(id: string, handler: (args?: unknown) => Promise<unknown>): Disposable;
    executeCommand(id: string, args?: unknown): Promise<unknown>;
  };

  readonly workspace: {
    read(path: CodocPath): Promise<CodocDetail | null>;
    write(path: CodocPath, content: string): Promise<void>;
    list(): readonly CodocPath[];
    onDidChange(handler: (e: CodocChangeEvent) => void): Disposable;
  };

  readonly chat: {
    openPrompt(prompt: string): void;
  };

  readonly subscriptions: Disposable[];
}
```

## 5. 分阶段路线图

按依赖关系排：**Phase 0 → Phase 1 → Phase 2 → (Phase 3 与 Phase 4 并行) → Phase 5**。Phase 6 任意时间插入。

每个 Phase 是一个独立 slice，完成后系统仍可启动并通过端到端验证。

### Phase 0 — Domain / Runtime API 拆分

**目的**：先把"纯"与"副作用"之间的 API 边界立住。后续 plugin host 需要 domain 层是真的纯（没有 IO、没有 esbuild、没有 chokidar），否则 ctx 设计无法收敛。

**关键认知**：这一步**不是 rename**。`apps/local/src/workspace/index.ts` 实际上是混杂的——

| 关注点 | 位置 | 性质 |
| --- | --- | --- |
| `LocalCodoc` / `Workspace` 类型 | line 21-39 | 纯 |
| `loadFile` (readFile + parse) | line 70-87 | IO |
| `removeFile` (delete .mdx) | line 90-98 | IO |
| `resolveAll` (依赖 sourceState 读/写) | line 101-130 | IO + 纯 orchestration |
| `compileAll` / `compileOne` (writeFile .mdx) | line 132-149 | IO |
| `writeCodoc` (parse → diagnose → write → reload) | line 157-201 | IO + 纯 orchestration |
| `buildAstMap` | line 204-210 | 纯 |
| `loadComponents` (scanComponents → esbuild) | line 213-216 | IO |
| `findCodocFiles` (readdir) | line 222-235 | IO |

`resolve.ts` / `diagnose.ts` / `recognize.ts` / `patch.ts` 已经是纯的。`service.ts` / `watcher.ts` / `components.ts` 已经是副作用。混在一起的只有 `workspace/index.ts` 这一个文件。

**改动**

1. 新建 `apps/local/src/domain/`，搬入：
   - `resolve.ts`、`diagnose.ts`、`diagnose.test.ts`、`recognize.ts`、`patch.ts`（不变）
   - 新建 `domain/types.ts`：导出 `LocalCodoc`、`Workspace`、`WriteResult` 类型，以及 `buildAstMap` 这一纯函数
2. 新建 `apps/local/src/runtime/`，搬入：
   - `service.ts`、`watcher.ts`、`components.ts`（不变）
   - 新建 `runtime/workspace.ts`：搬入 `loadWorkspace` / `loadFile` / `removeFile` / `resolveAll` / `compileAll` / `compileOne` / `writeCodoc` / `loadComponents` / `findCodocFiles`——所有 IO orchestration
3. 删除 `apps/local/src/workspace/`，旧 import 路径分流：
   - 旧 `workspace/index.js` 的类型 / `buildAstMap` import → `domain/types.js`
   - 旧 `workspace/index.js` 的 `loadWorkspace` / `compileAll` / `writeCodoc` 等 import → `runtime/workspace.js`
   - 旧 `workspace/{resolve,diagnose,recognize,patch}.js` → `domain/{...}.js`
   - 旧 `workspace/service.js` / `watcher.js` / `components.js` → `runtime/{...}.js`
4. 两边各加 `AGENTS.md`：
   - `domain/`：`Reads from: @cobook/{core,parser,compiler}`、`Must never import: node:fs, esbuild, chokidar, ../runtime/`
   - `runtime/`：`Reads from: ../domain/`、`Must never import: ../server/, ../plugins/, ../plugins-host/`
5. 更新 `apps/local/AGENTS.md` 的 Subtrees 段

**验收**

- `pnpm typecheck` 通过
- `grep -r "node:fs\|chokidar\|esbuild" apps/local/src/domain/` 必须为空
- `pnpm build` 产物可启动，RSS workspace 端到端跑通

**估时**：1d。文件移动量小，但要 trace 全仓 `workspace/...` 的 import 并分流到 domain/runtime 两个目标。

### Phase 1 — Plugin 单目录落地

**目的**：解决 UI 和逻辑物理割裂，为 manifest + activate 改造做好目录基础。

**改动**

- 新建 `apps/local/plugins/rss/{server,ui,components,template}/`
- 物理迁移（保留接口不变）：
  - `apps/local/src/plugins/rss/*.ts` → `apps/local/plugins/rss/server/*.ts`
  - `apps/local/ui/src/plugin-views/rss/*.tsx` → `apps/local/plugins/rss/ui/panels/*.tsx`
  - `apps/local/src/templates/rss/components/*.tsx` → `apps/local/plugins/rss/components/*.tsx`
  - `apps/local/src/templates/rss.ts` → `apps/local/plugins/rss/template/index.ts`
- **Template 的 raw: 引用要重写**：`templates/rss.ts:9-15` 用 `raw:./rss/components/ArticleList.tsx` 等指向 sibling 目录的 TSX，移到 `plugins/rss/template/index.ts` 后要改成 `raw:../components/ArticleList.tsx`。`tsup.config.ts` 的 `rawImportPlugin` 解析逻辑无变化（基于 importer 的 dirname），路径调一下即可。
- 新建 `apps/local/plugins/rss/manifest.json`，**此阶段只填 metadata**（id / name / description / icon），其他字段在 Phase 2 加
- `plugins/rss/server/index.ts` 仍 export 旧 `WorkspacePlugin` 对象，import 路径相对调整
- `plugins/rss/ui/index.ts` export `{ panels: { ... } }`
- `apps/local/src/plugins/registry.ts` 改成 `import { rssPlugin } from "../../plugins/rss/server/index.js"`
- `apps/local/ui/src/plugin-views/registry.ts` 改成 `import ... from "../../../plugins/rss/ui/panels/..."`
- `apps/local/src/templates/index.ts` 改成从 `../../plugins/*/template/index.js` import 模板对象（Phase 1 仍是静态聚合，Phase 2 才接 manifest entry pointer）
- `apps/local/ui/vite.config.ts`：root 调到 `apps/local`，入口指向 `ui/index.html`，alias 加 `@plugins → apps/local/plugins`
- `apps/local/tsup.config.ts`：entry 仍是 `src/index.ts`，import 路径合法即可
- `default` plugin 同样迁移
- 旧 `apps/local/src/plugins/{rss,default}/` 与 `apps/local/ui/src/plugin-views/` 与 `apps/local/src/templates/rss/` 目录删除（保留 `templates/index.ts`、`templates/types.ts`、`templates/yaml.ts`、`templates/bookmarks*` 直到 Phase 2 决定 bookmarks 模板归属）

**验收**

- `pnpm dev` / `pnpm build` 跑通
- RSS workspace 打开、Subscriptions / Saved 面板正常渲染
- `codoc init --from rss` scaffold 文件齐全（含 `validateTemplateContent` 通过）
- 内置 MDX 组件渲染正常

**估时**：1d。最大风险是 Vite root 改动 + `raw:` 引用路径修正。

### Phase 1.5 — rssProvider 归还 RSS plugin

**目的**：把 §1.4 的归属错误修掉。让 `@cobook/parser` 回归"纯 codoc 格式抽象"，让 RSS plugin 真正拥有 `$source: rss` 的解析逻辑。本阶段还**不**接 manifest entry pointer——host 仍然静态 import provider，只是 import 源从 parser 变成 RSS plugin。Phase 2 才把 import 路径换成 manifest 驱动。

**关键判断**：这阶段单独立 phase 的原因是它跨包改动（动 `packages/parser`），跟 plugin 目录布局 / manifest 协议正交。可以独立验收，独立回滚。

**改动**

1. 把 `packages/parser/src/rss.ts` 整体物理迁移到 `apps/local/plugins/rss/server/source-provider.ts`
   - 文件内容不变（`rssProvider` + `parseRssItems` + `parseAtomEntries` + Atom XML 解析）
   - import 路径：`from "./source.js"` → `from "@cobook/parser"`（SourceProvider / MergeContext 类型仍由 parser 导出）
2. 修 `packages/parser/src/registry.ts`：删除 `rssProvider` import 和 Map 条目，`createSourceRegistry()` 只剩 `httpJsonProvider`
3. 修 `packages/parser/src/index.ts`：删除 `rssProvider` 的 re-export（如有）
4. RSS plugin 新建 source provider 注册逻辑：在 `apps/local/plugins/rss/server/index.ts`（旧 `WorkspacePlugin` 对象）的 module 顶层 `export { rssProvider }`，host 静态 import
5. 修 host 启动：`apps/local/src/server/http.ts:205` 和 `:399` 两处 `createSourceRegistry()` 之后立刻 `registry.set("rss", rssProvider)`——v2.5 临时方案，Phase 2 改为 manifest 驱动
   - 具体位置可以放到 `setupSourceRegistry(state, plugins)` 这种 helper，让 Phase 2 替换实现更简单
6. 删除 `WorkspacePlugin.sourceProviders?()` dead hook（apps/local/src/plugins/types.ts:125）
7. 更新各 AGENTS.md：
   - `packages/parser/AGENTS.md`：说明 parser 不再包含 domain-specific schemes
   - `apps/local/plugins/rss/AGENTS.md`：删 "Does NOT own: rssProvider (parser layer)"，改成 "Owns: rss source provider"
8. 检查 `legacy/` 旧目录有无 `rssProvider` 引用，与本次改动无关只是确认

**验收**

- `grep -rn "rssProvider" packages/parser/src/` 必须为空
- `grep -rn "RSS\|rss" packages/parser/src/` 必须为空（包括 Atom XML / `parseRssItems`）
- `pnpm typecheck` 通过
- 现有 RSS workspace 端到端跑通（首轮 fetch RSS feeds、digest job、AI summary 不变）
- 重新打开有 cached `$source: rss` 数据的 workspace，加载不报错（即使没有重新 fetch）
- 全新 `codoc init --from rss` 后首次刷新 feeds 能拿到内容

**估时**：0.5d。文件迁移 + 两处 host 注册点 + 跨包 import 替换。

**风险**：
- `legacy/` 还有 cobook 旧实现可能引用 parser 的 rss——如果是的话先确认这条路径已弃用
- httpJsonProvider 是否真的 generic：检查它是否含 RSS 假设；若纯 HTTP JSON 抓取则留 parser

### Phase 2 — Manifest + Activate API（淘汰 `WorkspacePlugin` 接口）

**目的**：把声明式与程序式分层，让 `apps/local/src/` 完全不知道 RSS 存在。

**改动**

- 新建 `apps/local/src/plugins-host/`：
  - `manifest.ts` — schema、parser、validator（ajv）
  - `context.ts` — `ActivateContext` / `UiActivateContext` 实现
  - `host.ts` — 加载 manifest、调用 `activate(ctx)` / `activateUi(ctx)`、管理 Disposable 集合、teardown
  - `command-bus.ts` — server / UI 命令统一注册 + HTTP 桥（UI 调用 server 命令走 POST `/api/plugins/<id>/commands/<cmdId>`）
  - `disposable.ts` — `Disposable` / `DisposableStore`
- 每个 plugin 改造：
  - `manifest.json` 填齐所有 contributes 字段
  - `server/index.ts` 改为 `export function activate(ctx: ActivateContext<Config>): void | Promise<void>`
  - `ui/index.ts` 改为 `export function activateUi(ctx: UiActivateContext<Config>): void`
- v1 接口字段的迁移映射：

  **Static contributions（pre-activation）**

  | 旧 hook / 字段 | 新位置 |
  | --- | --- |
  | `parseConfig` | `manifest.contributes.configurationSchema`（JSON Schema 字面量），host ajv 校验 |
  | rssProvider 注册（Phase 1.5 后由 host 静态绑死） | `manifest.contributes.sourceProviders[].entry` 指向 provider 工厂；host 在 `loadWorkspace` 前 import + 注册到 global `SourceRegistry`。这一步替换掉 Phase 1.5 留下的 `registry.set("rss", rssProvider)` 临时硬编码 |
  | `detectWorkspace()` | `manifest.contributes.legacyDetect.entry` 指向 detect 函数；host 加载完 workspace、激活前调用。**保留程序化形式**——RSS 的 AST 字段检查（`apps/local/src/plugins/rss/detect.ts:21-23`）无法用 declarative hint 表达 |
  | `template` | `manifest.contributes.templates[].entry` 指向 `Template` 对象；host 在 `codoc init --from` 时 import + 执行 `files()` |
  | `getAgentInstructions()` | `manifest.contributes.agentInstructions: "assets/agent-prompt.md"`，host 读文件 |

  **Activation contributions（`activate(ctx)`）**

  | 旧 hook / 字段 | 新位置 |
  | --- | --- |
  | `createApiRoutes()` | `activate` 内 `ctx.routes.use(router)` |
  | `registerMcpTools()` | `activate` 内 `ctx.mcp.registerTool(...)`（schema 已在 manifest 声明） |
  | `startJobs()` | `activate` 内 `ctx.jobs.start(...)` |

  **UI contributions（manifest + `activateUi(ctx)`）**

  | 旧 hook / 字段 | 新位置 |
  | --- | --- |
  | `getUiSpec().homeView / homeCodocPath / hiddenPaths` | `manifest.contributes.ui` |
  | `getUiSpec().primaryActions` | Phase 3 改为 commands + menus |
  | `getUiSpec().secondaryViews` | `manifest.contributes.views` + `activateUi` 内 `ctx.views.registerView(id, Component)` |
  | 内置 MDX 组件（v1 通过 template 拷贝） | `manifest.contributes.mdxComponents` + Phase 4 的 `ctx.mdxComponents.register(...)` |
- `apps/local/src/plugins/types.ts` 删除；保留临时 re-export shim 一段时间后清掉
- `apps/local/src/server/http.ts` 中所有 `state.activePlugin`、`buildPluginContext` 等改为通过 plugins-host 暴露的 `state.pluginHost` 调用

**验收**

- RSS 所有行为（订阅 CRUD、digest job、source refresh、AI summary、subscriptions / saved 面板）端到端通过
- 切 workspace 时旧 plugin 的 disposable 全部释放（jobs 停、router 卸载、SSE 不再推旧事件）
- `default` plugin 用空 `activate` 也能跑（即什么都不注册）

**Host 启动顺序（最终态）**

```
server boot
  ├─ 1. plugins-host.scanManifests()                     ← 读所有 plugins/*/manifest.json
  ├─ 2. plugins-host.registerStaticContributions()
  │     ├─ for each plugin: import manifest.sourceProviders[].entry → SourceRegistry
  │     ├─ for each plugin: import manifest.templates[].entry → TemplateRegistry
  │     └─ for each plugin: import manifest.legacyDetect?.entry → DetectorList
  ├─ 3. createProviderRegistry() (chat providers — 不变)
  └─ 4. listen
```

```
openWorkspace(name)
  ├─ 1. teardown 旧 ctx（DisposableStore.dispose 全部）
  ├─ 2. read codoc.config.json + parseWorkspaceConfig
  ├─ 3. loadWorkspace(dir, outDir, SourceRegistry) ← provider 已就绪
  ├─ 4. compileAll
  ├─ 5. host.resolvePlugin(ws, config) → 用 workspaceKind 或 DetectorList
  ├─ 6. ajv 校验 pluginConfig 通过 manifest.configurationSchema
  ├─ 7. host.activate(plugin, ctx) → 调 plugin.activate(ctx)
  ├─ 8. startWatcher / startScheduler / 等首轮 tick
  └─ 9. host.activateUiSurface() → SPA 通过 /api/workspace 拿到 manifest 切片
```

**估时**：2.5d。三个风险点：

1. **启动顺序重写**：把 source provider 注册从 `openWorkspace` 路径（Phase 1.5 临时位置）抽出来挪到 server boot——provider registry 变成 host 进程全局而不是 per-workspace
2. **Disposable 模型**：切 workspace 必须真的把上一个 ctx 释放干净（jobs / router / MCP tools / SSE handler / per-workspace command 注册）。注意 source provider **不**进 DisposableStore——它是 host-global static contribution，跨 workspace 共享
3. **Template entry 协议落地**：把现有 `templates/{index,types}.ts` 改成读 manifest entry pointer，但保留 `Template` 接口（含 `files()`、`components[]`、`agentInstructions`）和 `init.ts` 的 `validateTemplateContent` / `addComponent` 路径——这一步只迁路由不动逻辑

### Phase 3 — Commands + Menus

**目的**：统一交互入口，UI 不再硬编码 plugin 行为。

**改动**

- `WorkspaceUiSpec.primaryActions` 整个废掉
- RSS 把 "Refresh feeds" / "Update digest" / "Subscribe" 改为三个 `commands` + 三条 `menus.workspace.actionBar` 条目
- UI 侧 `WorkspaceActionBar` 重写：读 host 暴露的 menu 列表，按顺序渲染按钮，点击 `ctx.commands.executeCommand(id)`
- 加 Cmd+K 命令面板（`apps/local/ui/src/components/CommandPalette.tsx`）：枚举所有已注册命令，filter + 执行
- 文件树右键菜单 → `menus.fileTree.context`（v1 占位实现，不要求 plugin 提供）
- "chat-prompt" 类按钮（如 Subscribe 打开 chat 预填 prompt）改成 UI 命令，handler 调 `ctx.chat.openPrompt(...)`
- 命令路由规则：
  - server 命令注册（动 server 状态）：UI 调用走 HTTP `POST /api/plugins/<id>/commands/<cmdId>`
  - UI 命令注册（动 UI 状态）：直接本地调用
  - `executeCommand(id, args)` 自动按注册位置路由

**验收**

- 旧 actionBar 全部行为复现，且按钮顺序由 manifest 决定
- Cmd+K 可发现并执行 RSS 命令
- 命令面板对未注册 handler 的命令给出 disable 提示

**估时**：一天。

### Phase 4 — Plugin-shipped MDX 组件

**目的**：解决 plugin 组件随 scaffold 永久拷贝到用户目录、无法升级的问题。

**改动**

- `apps/local/plugins/rss/components/*.tsx` 不再随 scaffold 拷贝
- 构建时 esbuild 把 plugin 组件编译为 CJS，打进 plugin UI bundle
- `activateUi` 内 `ctx.mdxComponents.register("ArticleList", ArticleList)` 等
- MDX renderer 的 component lookup 优先级合并：内置 builtin → plugin shipped → 用户 `.codoc/components/`
- `apps/local/plugins/rss/template/` 只保留用户 starter 文件（`inbox.codoc`、`guide.codoc`、空 `components/` 目录、`agent-prompt.md`）
- 兼容老 workspace：startup 检测 `~/.codoc/<workspace>/components/` 下是否含同名 plugin 组件，给出 console 提示让用户删除（不强制 migration）

**验收**

- 全新 `codoc init --from rss` 的 workspace 不再拷贝 ArticleList / DigestList 等
- 渲染时 ArticleList 仍可用（来自 plugin shipped）
- 老 workspace 仍能 fall back 到本地 components/（用户优先级最高）

**估时**：半天。

### Phase 5 — ActivationEvents（潜力点）

**目的**：把激活模型立起来，为多 plugin 共存与第三方扩展做准备。功能价值有限，模型价值是主要诉求。

**改动**

- Manifest `activationEvents` 字段被 host 真的解析：
  - `onWorkspaceKind:<id>` — 打开匹配 workspace 时激活（v1 唯一实际生效的事件）
  - `onCommand:<id>` — 首次执行命令时激活（v1 可选实现）
  - `onStartupFinished` — 启动完成后激活
- Host 维护 plugin 状态机：`installed → activated → disposed`
- 命令面板列出所有 manifest 中声明的命令（即使未激活），点击时按需激活
- v1 仍保持"一个 workspace 一个 plugin"约束；多 plugin 共存的资源仲裁（hidden paths / home view 谁说了算）延后

**验收**

- 状态机切换有日志
- 切 workspace 时旧 plugin 走完 `disposed` 路径

**估时**：半天。

### Phase 6（推迟，保留潜力）— 第三方分发

**v1 不实现**，仅保留接口设计：

- Plugin 位置：`~/.codoc/extensions/<id>/` 或 npm 包
- Host 扫目录 → 读 manifest → 动态 `import()` server entry
- UI 半：host 暴露 `/api/plugins/<id>/ui-bundle.js`，浏览器动态 `import(/* @vite-ignore */ url)`
- Engine compat：`engines.codoc` semver 校验
- Permission scopes：manifest 声明 `scopes: ["routes", "mcp", "sources", "workspace.write"]`，host 按 scope 给阉割版 `ctx`
- 沙箱：先不上 process 隔离；高危 scope（`workspace.write`）需要用户确认

只要 Phase 0–5 落地干净，Phase 6 是"host 扫码 + 动态 import"的局部改造，不需要重构 plugin 协议。

## 6. 估时汇总

| Phase | 时长 | 风险点 |
| --- | --- | --- |
| 0 Domain/Runtime API 拆分 | 1d | 全仓 import 分流到 domain/runtime |
| 1 Plugin 单目录 | 1d | Vite root 改动；template `raw:` 路径修正 |
| 1.5 rssProvider 归还 RSS plugin | 0.5d | 跨包改动（动 packages/parser），cached data 兼容 |
| 2 Manifest + activate | 2.5d | 启动顺序重写；Disposable 模型；template entry 协议落地 |
| 3 Commands + Menus | 1d | 命令路由规则一致性 |
| 4 Plugin MDX 组件 | 0.5d | 与老 workspace 的兼容降级 |
| 5 ActivationEvents | 0.5d | 模型价值大于功能价值 |
| **合计（committed）** | **7d** | |
| 6 第三方分发 | — | 延后，保留潜力 |

## 7. 与现有规划的关系

- v1 `WorkspacePlugin` 接口与 Phase 0 host delta 均已落地（见上方"状态"）。本文档的 Phase 2 把 v1 接口收编为 manifest + activate，并沿用 Phase 0 的 `homeCodocPath` / `plugin-views/` / agent wiring 结构。
- `rss-product-roadmap.md` / `knowledge-workspace-plan.md` / `language-workspace-plan.md`：产品方向不变，但落地路径上"加一个 plugin"的成本会因为本文档而显著降低（写 manifest + 两个 activate 函数 + 自有 source provider，不动 host）。
- `packages/parser`：Phase 1.5 之后 parser 不再内置 RSS / Atom 解析；`createSourceRegistry()` 只剩 generic 的 `httpJsonProvider`，作为真正的"无 domain 假设的标准库"

## 8. 下一步

- 评审本文档
- 若通过，从 Phase 0 启动（域名/runtime API 拆分）
- Phase 1 启动前 review `vite.config.ts` 改动方案，确认 dev / build 两条路径都不破
- Phase 1.5 启动前确认 `legacy/` 无 `rssProvider` 残留引用
