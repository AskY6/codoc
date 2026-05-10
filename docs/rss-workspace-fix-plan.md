# RSS Workspace 修复执行单

## 目标

这份文档不是设计讨论，而是一份可以直接照着做的执行单。

目标只有一个：

> 让 RSS workspace 从“能跑的 codoc demo”变成“用户能直接用的 RSS 产品”。

这次修复的判定标准以 [rss-workspace-e2e.md](/Users/kxzhang/code/local-tool/codoc/docs/rss-workspace-e2e.md:1) 为准，至少要让以下场景成立：

1. 首次进入时，直接知道下一步做什么。
2. “看今天更新”不再主要依赖 prompt。
3. `Refresh feeds` 和 `Update digest` 是真实动作，不是文案。
4. 已读/收藏这类阅读路径不再明显依赖 generic codoc 交互。

## 现状问题

本轮端到端验证确认了 4 个核心问题：

1. RSS workspace 打开后仍然先落在通用文件树，不是 inbox-first。
2. RSS plugin UI spec 已存在，但前端没有消费。
3. `rssUiSpec` 里声明了 `refresh` / `digest`，但实际 route 还是 `404`。
4. `inbox` 和 chat 仍然把用户主路径引回 “ask the agent”。

## 执行原则

1. 先接线，再优化。
2. 优先修用户主路径，不先做大重构。
3. 每个阶段完成后都必须重新执行一次 e2e 验证。
4. 平台能力留在 host，RSS 只拥有垂直领域能力。

## 阶段 1：把 plugin UI spec 接到前端

### 目标

让 RSS workspace 真正表现成 `inbox-first`，而不是 generic workspace。

### 需要修改的文件

1. [apps/local/src/http-server.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/http-server.ts:153)
2. [apps/local/ui/src/api.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/ui/src/api.ts:145)
3. [apps/local/ui/src/App.tsx](/Users/kxzhang/code/local-tool/codoc/apps/local/ui/src/App.tsx:382)
4. 新增 [apps/local/ui/src/components/WorkspaceActionBar.tsx](/Users/kxzhang/code/local-tool/codoc/apps/local/ui/src/components/WorkspaceActionBar.tsx)

新建 `components/` 子文件不是新目录，不需要额外创建目录。

### 实施步骤

#### 1. 后端把 plugin UI spec 暴露给前端

在 `http-server.ts` 里处理 active workspace 信息时：

1. 读取 active plugin。
2. 如果 plugin 有 `getUiSpec()`，构造 plugin context 并调用它。
3. 在 `/api/workspace` 响应中新增：
   - `pluginId`
   - `uiSpec`

建议返回结构类似：

```ts
{
  active: true,
  name: state.workspaceName,
  codocCount: state.workspace.codocs.size,
  pluginId: state.activePlugin?.id ?? "default",
  uiSpec: ...
}
```

#### 2. 前端 API 类型补齐

在 `ui/src/api.ts`：

1. 定义 `WorkspaceUiActionDescriptor`
2. 定义 `WorkspaceUiSpec`
3. 把 `WorkspaceInfo` 扩展为：

```ts
interface WorkspaceInfo {
  active: boolean;
  name?: string;
  codocCount?: number;
  pluginId?: string;
  uiSpec?: WorkspaceUiSpec;
}
```

#### 3. WorkspaceApp 初始化时应用 `homeView`

在 `App.tsx`：

1. 把 `wsInfo` 继续往下传给 `WorkspaceApp`，不要只传 `workspaceName`
2. 在 `WorkspaceApp` 内部初始化后应用 `uiSpec.homeView`
3. 如果 `homeView === "inbox"`：
   - 优先选中 `inbox.codoc`
   - 如果 `inbox.codoc` 不存在，再 fallback 到旧逻辑

建议做法：

1. 在 `loadCodocs()` 完成后判断是否需要自动聚焦
2. 只在初次进入 workspace 时自动执行一次，避免每次刷新都把用户强行拉回 `inbox`

#### 4. 文件树支持 `hiddenPaths`

在 `App.tsx` 渲染 `FileTree` 前：

1. 根据 `wsInfo.uiSpec?.hiddenPaths` 过滤 `tree`
2. 先支持精确路径隐藏就够了
3. RSS 场景下至少隐藏 `guide.codoc`

#### 5. 在中心区域顶部增加 workspace 主动作栏

新增 `WorkspaceActionBar.tsx`：

1. 输入为 `uiSpec.primaryActions`
2. 渲染按钮列表
3. 支持两种 action：
   - `kind: "rest"`
   - `kind: "chat-prompt"`

第一版 dispatch 规则：

1. `rest`：直接 `fetch(path, { method })`
2. `chat-prompt`：通过现有 event bus 发 `send-prompt`

在 `WorkspaceApp` 里：

1. 当 `uiSpec.primaryActions` 存在时，在 `main` 顶部渲染动作栏
2. `inbox` 被选中时动作栏最重要

### 完成标准

1. 打开 RSS workspace 后直接进入 `inbox`
2. 左侧不再显示 `guide`
3. 页面顶部能看到 `Refresh feeds` / `Update digest`

### 本阶段复测

执行：

1. `pnpm build`
2. `node dist/index.js start`
3. 打开 RSS workspace

通过条件：

1. 对应 [rss-workspace-e2e.md](/Users/kxzhang/code/local-tool/codoc/docs/rss-workspace-e2e.md:1) 的“场景 1：首次进入”
2. 不点文件树也能直接看到主阅读入口

## 阶段 2：把 refresh / digest 补成真实动作

### 目标

让 RSS 的主动作从“spec 文案”变成“真实功能”。

### 需要修改的文件

1. 新增 [apps/local/src/plugins/rss/service.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/plugins/rss/service.ts)
2. [apps/local/src/plugins/rss/api-routes.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/plugins/rss/api-routes.ts:1)
3. [apps/local/src/source-scheduler.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/source-scheduler.ts:1)
4. 可选调整 [apps/local/src/plugins/rss/index.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/plugins/rss/index.ts:1)

`apps/local/src/plugins/rss/` 已有 `AGENTS.md`，新增 `service.ts` 不需要额外建目录。

### 实施步骤

#### 1. 从 source scheduler 抽一个手动刷新 helper

在 `source-scheduler.ts`：

1. 保留 `startSourceScheduler()` 不动
2. 抽出一个可复用 helper，例如：

```ts
export async function refreshDueSources(...)
export async function refreshAllPeriodicSources(...)
```

建议：

1. `startSourceScheduler()` 内部继续调用 `refreshDueSources()`
2. RSS plugin 的 `refresh` route 调 `refreshAllPeriodicSources(..., { force: true })`

不要把 scheduler 搬进 RSS plugin。

#### 2. 新建 RSS domain service

在 `plugins/rss/service.ts` 实现：

1. `refreshFeeds(ctx)`
2. `generateDigest(ctx)`

推荐接口：

```ts
interface RssServiceContext {
  workspace: Workspace;
  updates: EventEmitter;
  pluginConfig: RssPluginConfig;
}
```

`refreshFeeds(ctx)`：

1. 调用从 `source-scheduler.ts` 抽出来的手动刷新 helper
2. 返回：
   - 刷新了多少 source
   - 哪些 source 成功
   - 哪些 source 失败

`generateDigest(ctx)`：

第一版不要过度设计，目标是先跑通：

1. 扫描 `sourcesDir` 下的 RSS codoc
2. 收集 `articles`
3. 过滤未读文章
4. 生成 `highlights[]`
5. 生成 `trending[]`
6. 更新 `digestCodocPath` 对应 codoc 的：
   - `highlights`
   - `trending`
   - `lastDigestAt`

如果你已经有现成的 AI digest 逻辑：

1. 直接在 `generateDigest()` 里调用它
2. 但 route 层要保持稳定，不再暴露成 prompt

如果暂时没有：

1. 第一版可以先做 deterministic digest
2. 例如按发布时间取前 N 条，摘要先退化成 title + source
3. 之后再把摘要器替换成 AI

关键点：

1. 用户路径先从“聊天命令”升级成“产品动作”
2. 内部是不是 AI，可以第二步再增强

#### 3. 在 RSS plugin route 里接上 action

在 `plugins/rss/api-routes.ts` 新增：

1. `POST /refresh`
2. `POST /digest`
3. 保留 `PATCH /articles/*`

返回结构建议统一：

```ts
{ ok: true, ... }
{ ok: false, error: "..." }
```

### 完成标准

1. `POST /api/plugins/rss/refresh` 返回 200
2. `POST /api/plugins/rss/digest` 返回 200
3. UI 动作栏点击后可以直接触发这两个 endpoint

### 本阶段复测

1. 打开 RSS workspace
2. 点击 `Refresh feeds`
3. 点击 `Update digest`
4. 检查 `inbox` 内容是否更新

通过条件：

1. 对应 [rss-workspace-e2e.md](/Users/kxzhang/code/local-tool/codoc/docs/rss-workspace-e2e.md:1) 的“场景 2：查看今天有什么更新”
2. 不需要手工输入 “what's new today?”

## 阶段 3：移除“ask the agent”主路径

### 目标

让 RSS 首页和空状态回到产品动作，而不是 prompt 导向。

### 需要修改的文件

1. [apps/local/src/templates/rss.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/templates/rss.ts:52)
2. [apps/local/ui/src/components/ChatPanel.tsx](/Users/kxzhang/code/local-tool/codoc/apps/local/ui/src/components/ChatPanel.tsx:513)
3. [apps/local/ui/src/App.tsx](/Users/kxzhang/code/local-tool/codoc/apps/local/ui/src/App.tsx:620)

### 实施步骤

#### 1. 改 `inbox.codoc` 文案

在 `templates/rss.ts` 的 `inboxCodoc()` 里：

1. 空状态不再写：
   - `Ask the agent: 'what's new today?'`
2. 改成动作导向：
   - `No digest yet. Refresh feeds and update digest.`

stale digest 提示也一样：

1. 不再写 `Ask the agent: 'refresh my digest'`
2. 改成 `Update digest to refresh this inbox`

#### 2. 调整 ChatPanel 在 RSS workspace 下的 quick actions

现在逻辑是：

1. active codoc 时显示 generic action
2. 没 active codoc 时才显示 `wsConfig.quickActions`

这对 RSS 不对。

改法：

1. 在 `ChatPanel` 增加 `pluginId?: string`
2. `App.tsx` 把 `wsInfo.pluginId` 传进去
3. 如果 `pluginId === "rss"`：
   - active codoc 是 RSS feed 时，quick actions 换成 RSS 语义动作
   - 例如：
     - `Summarize this feed`
     - `Find the most important unread items`
     - `Research a topic across feeds`
4. 不再给 RSS feed 默认显示：
   - `Suggest fields`
   - `Improve view`

### 完成标准

1. `inbox` 空状态不再引导“先问 agent”
2. chat 里不再把 generic codoc action 当 RSS 默认入口

### 本阶段复测

重测：

1. 场景 1：首次进入
2. 场景 2：看今天更新
3. 场景 6：AI 增强阅读

通过条件：

1. 用户主路径不再依赖“先开 chat”
2. chat 只负责增强，不负责基础导航

## 阶段 4：收口订阅和文章状态路径

### 目标

让 RSS 的操作边界更干净，减少“新路径和旧路径混着跑”的状态。

### 需要修改的文件

1. [apps/local/src/plugins/rss/api-routes.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/plugins/rss/api-routes.ts:1)
2. [apps/local/src/api-routes.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/api-routes.ts:149)
3. [apps/local/src/templates/rss/components/ArticleList.tsx](/Users/kxzhang/code/local-tool/codoc/apps/local/src/templates/rss/components/ArticleList.tsx:1)
4. 可选新增 [apps/local/src/plugins/rss/subscribe.ts](/Users/kxzhang/code/local-tool/codoc/apps/local/src/plugins/rss/subscribe.ts)

### 实施步骤

#### 1. 先确定旧路径兼容策略

现在已有 workspace 里的 `components/ArticleList.tsx` 是初始化时拷贝到用户目录的。  
这意味着只改模板文件，不会修复已有 workspace。

所以先定一个兼容策略：

1. 短期保留旧的：
   - `/api/codoc/:path/articles/:field/:index`
2. 新模板改成新的：
   - `/api/plugins/rss/articles/...`

这样老 workspace 不会坏，新 workspace 走新路径。

#### 2. 新模板切到 plugin route

在 `templates/rss/components/ArticleList.tsx`：

1. 把 fetch URL 改成 `/api/plugins/rss/articles/...`
2. 这只影响以后新建的 workspace

#### 3. 视需要补订阅 endpoint

如果要把“订阅 feed”也从 prompt 中拿出来：

1. 新增 `POST /api/plugins/rss/subscribe`
2. 在 service 层做：
   - 规范化 feed title / slug
   - 生成 `sources/<slug>.codoc`
   - 使用 `defaultSourceIntervalMinutes`
3. 写入后执行一次刷新

如果你当前还不准备做独立订阅 UI：

1. 这一步可以先延后
2. 但至少要把 API 留好，不再把订阅建模成 prompt-only

### 完成标准

1. 老 workspace 还能正常操作文章状态
2. 新 workspace 开始走 plugin route
3. 订阅能力有明确的落地路线，不再只停留在 prompt

### 本阶段复测

重测：

1. 场景 3：订阅一个新的 feed
2. 场景 4：标记已读 / 收藏，并验证状态持久化

通过条件：

1. 用户不需要编辑 `sources/*.codoc`
2. 阅读状态在刷新和重开后可信

## 执行顺序

严格按这个顺序做：

1. 阶段 1：UI spec 接线
2. 阶段 2：refresh / digest route
3. 阶段 3：去掉 prompt 主路径
4. 阶段 4：状态与订阅收口

不要跳着做。  
如果先做阶段 4，再回头做阶段 1 和 2，用户主路径还是不会成立。

## 每阶段固定动作

每完成一个阶段，都执行这 5 步：

1. `pnpm build`
2. `node dist/index.js start`
3. 打开本地 UI
4. 跑对应的 e2e 场景
5. 记录结果到 [rss-workspace-e2e.md](/Users/kxzhang/code/local-tool/codoc/docs/rss-workspace-e2e.md:1)

## 第一优先级交付

如果你现在只想先做最小闭环，只做这些：

1. 阶段 1 全部
2. 阶段 2 里的 `refresh` / `digest`
3. 阶段 3 里的 `inbox` 空状态文案改造

做到这一步后，RSS workspace 至少会从：

- “文件树 + prompt”

变成：

- “inbox-first + 动作按钮”

这就是第一阶段真正的产品分水岭。
