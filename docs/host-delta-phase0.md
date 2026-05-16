# Host Delta — Phase 0

## 背景

两份 vertical workspace plan（`knowledge-workspace-plan.md` / `language-workspace-plan.md`）都假设了"dashboard 首屏""plugin 拥有自己的 secondary view""注册 specialist agent""通过 CodocId 引用 codoc"等能力。但当前宿主（`apps/local` + `packages/service`）并不具备这些能力，把它们塞进 plugin 实现会污染 vertical 边界。

Phase 0 把宿主侧的最小 delta 集中列出来，作为两份 plan **Phase 2（plugin 后端实现）之前**的 prerequisite。Phase 1（领域收口）可以与 Phase 0 并行。

这份文档不是任一 vertical 的工作，是宿主工作。

## 决策摘要

| # | 决策点 | v1 选择 |
| --- | --- | --- |
| 1 | dashboard 首屏 | 在 `WorkspaceUiSpec` 上加 `homeCodocPath?: string`，泛化 App.tsx 的 auto-focus |
| 2 | plugin view 渲染槽位 | apps/local/ui/src/plugin-views/ 目录 + 静态 registry；App.tsx 改为通用渲染 |
| 3 | ref 模型 | v1 全部使用 `CodocPath`；`CodocId` 不引入 local runtime |
| 4 | agent wiring | 修复 `plugin.getAgentInstructions()` dead-code 路径；**不引入 specialist 注册** |

## 1. dashboard / homeCodocPath 首屏

### 当前状态

- `WorkspaceUiSpec.homeView: "tree" | "inbox"`（`apps/local/src/plugins/types.ts:96`）
- App.tsx 只对 `homeView === "inbox"` 触发 auto-focus 到字面量 `inbox.codoc`（`apps/local/ui/src/App.tsx:520-530`）
- 没有任何机制让 plugin 指定"第一次进入时打开 X codoc"

### Phase 0 修改

- 在 `WorkspaceUiSpec` 上新增 `homeCodocPath?: string` 字段
- App.tsx 的 auto-focus 逻辑泛化：
  - 优先：`uiSpec.homeCodocPath` 存在且对应 codoc 已加载 → focus
  - 兜底：保留现有 `homeView === "inbox"` → `inbox.codoc` 行为，向后兼容
- knowledge / language plugin 通过设置 `homeCodocPath: "dashboard.codoc"` 表达 dashboard-first

### 不做

- 把 `homeView` 重写成 ADT
- 给 dashboard 一个专门的渲染壳（仍走 `DocumentPanel` 渲染普通 codoc）
- 删除 `homeView` 字段（RSS 还在用）

## 2. plugin view 渲染槽位

### 当前状态

- App.tsx line 964-967 硬编码两个分支：`focus.viewId === "rss-subscriptions"` → `<SubscriptionsPanel />`、`focus.viewId === "rss-saved"` → `<SavedArticlesPanel />`
- `WorkspaceUiSpec.secondaryViews` 只声明 `{ id, label, icon }`，不携带 component
- 新 plugin 加 secondary view 必须改 App.tsx，不可持续

### Phase 0 修改

- 新建目录 `apps/local/ui/src/plugin-views/<pluginId>/`，每个 plugin 的 view 组件就近放
- 加一个静态 registry：
  ```ts
  // apps/local/ui/src/plugin-views/registry.ts
  export const pluginViewRegistry: Record<string, Record<string, React.ComponentType<PluginViewProps>>> = {
    rss: { "rss-subscriptions": SubscriptionsPanel, "rss-saved": SavedArticlesPanel },
    knowledge: { /* filled by knowledge phase */ },
    language: { /* filled by language phase */ },
  };
  ```
- App.tsx 改为通用渲染：`pluginViewRegistry[pluginId]?.[focus.viewId]`，找不到则渲染空状态
- 现有 RSS 硬编码分支迁入 registry

### 不做

- 动态加载 / 跨 bundle 注册
- plugin 反向声明 React component（plugin 在 server 侧，UI 在 browser bundle，两者不共享 ESM 图）
- 给 plugin view 加复杂 props 协议（v1 props 维持当前 `onSelectCodoc` 等已有形态）

## 3. ref 模型：v1 用 CodocPath，不用 CodocId

### 当前状态

- `LocalCodoc.path: CodocPath`（`apps/local/src/workspace/index.ts:21`），CodocPath 是 branded string，已是稳定 ID
- `Workspace.codocs: Map<CodocPath, LocalCodoc>` path-keyed（`apps/local/src/workspace/index.ts:33`）
- `LocalCodoc` 上**没有** `id: CodocId` 字段，local runtime 不构造 CodocId
- core 层 `CodocId` 类型存在，是为未来 cross-workspace / cross-system 寻址保留的，不是 v1 工作

### Phase 0 决策（只定规则，不动代码）

- v1 内所有跨 codoc 引用使用 `CodocPath`
- 两份 plan 的字段：
  - knowledge `Evergreen Note.relatedSources: CodocPath[]`
  - language `Word.sourceRefs: CodocPath[]`
- `addWord` tool / `POST /words` 接收 `sourceCodocPath?: CodocPath`（不是 `sourceCodocId`）
- 当未来 cross-workspace 联动真要做时，再决定是否在 LocalCodoc 上补 `id: CodocId`、以及如何从 path migrate 到 id

### 不做

- 在 LocalCodoc 上补 `id: CodocId` 字段
- 改 `Workspace.codocs` Map 的 key 类型
- 改 core 的 ID 模型
- 任何 path → id 的 migration 工具

## 4. agent wiring：先修 dead-code，再谈 specialist

### 当前状态

- `WorkspacePlugin.getAgentInstructions()` hook 存在（`apps/local/src/plugins/types.ts:135`）
- **但实际没人调用它** — `grep "\.getAgentInstructions(" apps/local packages` 0 个匹配
- 各 provider（`claude-code.ts` / `codex.ts` / `kiro.ts`）调 `readAgentInstructions(workspace)`（`apps/local/src/providers/types.ts:58-66`），**直接读 `codoc.config.json` 的 agentInstructions 字段，不感知 plugin**
- 真正的 router + specialist 图在 `packages/service/src/usecases/agent/run-agent-turn.ts:208-232`，用硬编码 `if (id === RSS_AGENT_ID) ... else if (id === PERF_REVIEW_AGENT_ID) ...` 分发；**没有 plugin-registered specialist 机制**

### Phase 0 修改

- 把 `readAgentInstructions` 改为接收 active plugin 引用：
  ```ts
  export function readAgentInstructions(
    workspace: Workspace,
    plugin?: WorkspacePlugin<unknown>,
    pluginCtx?: WorkspacePluginContext<unknown>,
  ): string | undefined;
  ```
- 合并顺序：`plugin.getAgentInstructions(pluginCtx)` prefix + `codoc.config.json.agentInstructions` suffix（plugin 提供基线，user config 增量覆盖）
- 各 provider call site（claude-code / codex / kiro）传入当前 workspace 的 active plugin

### 不做（v1 明确不在范围）

- plugin-registered specialist agent —— 这是 service 层工作，需要把 `run-agent-turn.ts:222` 的硬编码 if-branch 改成 registry，独立排期
- 两份 vertical plan 在 v1 内**不假设 specialist agent 存在**，只通过 `getAgentInstructions` 影响 base / general agent 的 prompt，加上 `registerMcpTools` 贡献工具
- 跨 workspace agent 上下文（language specialist 读 RSS codoc 之类）

## 验收

Phase 0 完成的判据：

1. 一个新 plugin 设置 `homeCodocPath: "dashboard.codoc"` + 自带 dashboard.codoc，能在首次进入 workspace 时自动 focus
2. 一个新 plugin 在 `apps/local/ui/src/plugin-views/<pluginId>/` 下放组件 + 在 registry 注册，secondary view 即可被 App.tsx 渲染，**不需要改 App.tsx 主体**
3. 一个新 plugin 的 `getAgentInstructions()` 实际被 provider 读到（curl chat → system prompt 里能看到 plugin 贡献的内容）
4. 两份 vertical plan 的字段定义改为 `CodocPath[]`，文档不再出现 `CodocId` / "register specialist" 字样

## 排期

- Phase 0 是宿主工作，建议**先于** knowledge / language 的 Phase 2（plugin 后端实现）
- Phase 1（领域收口、字段定义、读模型 shape）不依赖宿主能力，可以与 Phase 0 并行
- specialist 注册机制是独立未来 task，不在 Phase 0、也不在两份 vertical 的 v1 范围
