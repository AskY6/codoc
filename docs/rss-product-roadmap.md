# RSS Workspace 产品化路线图

## 目标

把 RSS workspace 从"作者自己能用的 AI 工具"推进到"可以推荐给同事日用"的状态。

核心架构转型：**让产品的基本循环（订阅 → 刷新 → 阅读 → 分拣 → 摘要）在没有 AI 参与的情况下完全可用、可观测、可预测。** AI 退到增强层——更好的摘要、更聪明的排序、深度研究——这些失败了不影响核心体验。

## 当前状态

已完成：
- WorkspacePlugin 架构落地，RSS 作为一等 plugin 运行
- inbox-first UI + action bar（refresh / digest / subscribe）
- 文章交互（已读、收藏）通过 SSE 实时推送
- source-scheduler 通用周期刷新
- RSS provider 的 link-based merge 保留用户状态

仍存在的问题：
- 文章无稳定 ID，靠数组下标定位
- API 只有 3 个端点（refresh / digest / patch-by-index），无订阅 CRUD
- 无 feed 健康状态追踪（lastError / consecutiveFailures 不存在）
- 订阅管理只能通过 chat prompt
- WorkspaceUiSpec 无 secondary views 概念
- 模板组件 copy 进 workspace 后不会随升级更新
- digest 只按时间排序，无多维 ranking

## 工作流

### WF-1: 域模型收口

把"什么是订阅、什么是文章、什么是状态"定义清楚。

**领域读模型 — Subscription：**

| 字段 | 说明 |
|------|------|
| slug | 唯一标识，对应 sources/{slug}.codoc |
| title | 显示名 |
| feedUrl | RSS/Atom URL |
| whyFollow | 订阅理由 |
| codocPath | 对应 codoc 文件路径 |
| intervalMinutes | 刷新间隔 |
| articleCount / unreadCount / starredCount | 计数 |
| lastFetchedAt / lastAttemptAt | 时间戳 |
| lastError / consecutiveFailures | 错误信息 |
| status | `"healthy" \| "failing" \| "never-fetched"` |

**Article 扩展字段：**

| 字段 | 层级 | 说明 |
|------|------|------|
| articleId | parser (merge 层) | 稳定 ID，详见下方 ID 生成策略 |
| sourceSlug | app 层 (读模型/API serializer) | 来源标识，从 codocPath 推导 |
| sourceTitle | app 层 (读模型/API serializer) | 来源显示名，从 codoc 静态字段读取 |

> **层级边界说明：** parser provider 只接收 feed params（url, limit）和 XML，不知道 workspace 的 slug 或 codoc title。sourceSlug/sourceTitle 的 enrichment 发生在 app 层（当前 service.ts 已有此模式：从 codoc 的 `"title"` 静态字段取 feedTitle）。articleId 可以在 merge 层生成（provider 拥有 link 信息），但需要调用方注入 slug 参数。

> **articleId 在 merge 层生成需要的接口变更：** 当前 `SourceProvider.merge(existing, incoming)` 签名没有上下文参数，调用方（`source-scheduler.ts:177`）直接传 `entry.params` 给 `execute()`，不传额外元数据给 `merge()`。要让 merge 层生成 articleId，有两个选项：
>
> - **选项 A（推荐）：扩展 merge 签名**，加入 context 参数：`merge(existing, incoming, ctx: { slug: string })`。scheduler 从 `entry.codocPath` 推导 slug 后传入。变更范围：`SourceProvider` 接口 + scheduler 调用点 + rssProvider.merge 实现。其他 provider 的 merge 可以忽略 ctx。
> - **选项 B：articleId 不在 merge 层生成**，而是由 app 层在 merge 结果写入 cache 前统一补全。缺点是 merge 内部按 preferredKey 去重时还需要二次匹配。
>
> M1 实施时需要先确认选项并落实接口变更。

**articleId 生成策略：**

优先级链：`guid > normalized(link) > hash(title + pubDate)`

1. parser 增加 `guid` 提取（RSS `<guid>` 元素，Atom `<id>` 元素）
2. link normalize：strip trailing slash、strip known tracking params（utm_*、ref、source）、统一 protocol
3. articleId = `hash(sourceSlug + preferredKey)`，其中 preferredKey 按优先级选取
4. fallback：如果 guid 和 link 都缺失，用 `hash(sourceSlug + title + pubDate)` 兜底（极端 case，接受不完美）

> **为什么不直接用裸 link：** 很多 feed 会改 tracking params、canonical URL，甚至 link 不稳定。不做 normalize 的话，"稳定 ID"仍然会出现同一篇文章多个 ID 的问题。

**设计决定：**
- `articleId` = deterministic hash，不用 UUID——可重算、可校验、无存储负担
- **merge key 与 articleId 共用同一套 preferredKey**（guid > normalizedLink > title+pubDate）。不允许出现"有 ID 但 merge 对不上"的状态——否则 fallback 场景下 readAt/starred 仍会丢失
- `Subscription` 是从 codoc 文件 + source-state 计算的读模型，不引入第二数据源
- feed 健康状态由 runtime 持久化在 `.source-state.json`，不靠 UI 推断

**改动边界：**
- `packages/parser/src/rss.ts` — 增加 guid 提取、link normalize、articleId 生成、merge key 升级
- `apps/local/src/source-state.ts` — 状态 schema 扩展（lastAttemptAt / lastError / consecutiveFailures）
- `apps/local/src/plugins/rss/service.ts` — Subscription 读模型计算 + sourceSlug/sourceTitle enrichment

**验收：**
- 任意文章在 refresh 前后 articleId 稳定
- 任意 feed 能计算出健康状态
- 这些信息不需要前端自己拼装

---

### WF-2: 后端 API 完整化

从 3 个端点扩展到完整的 domain API。

**API 面：**

| Method | Path | 作用 |
|--------|------|------|
| GET | /api/plugins/rss/subscriptions | 订阅列表 + 健康状态 |
| POST | /api/plugins/rss/subscriptions | 新增 feed |
| PATCH | /api/plugins/rss/subscriptions/:slug | 编辑 title / whyFollow / interval（URL 变更见下方） |
| PUT | /api/plugins/rss/subscriptions/:slug/url | 变更 feed URL（触发状态重置） |
| DELETE | /api/plugins/rss/subscriptions/:slug | 取消订阅 |
| POST | /api/plugins/rss/subscriptions/:slug/refresh | 刷新单个 feed |
| POST | /api/plugins/rss/refresh | 刷新全部（已有） |
| POST | /api/plugins/rss/digest | 更新 digest（已有） |
| GET | /api/plugins/rss/saved | 全局 starred articles |
| PATCH | /api/plugins/rss/articles/:articleId | 更新 readAt / starred |

**实现策略：**
- `api-routes.ts` 只做参数解析和 HTTP shape
- `service.ts` 保持单文件，按读/写分区；超 300 行再拆
- `subscribeFeed()` / `unsubscribeFeed()` 委托 workspace-service 做 codoc 文件 CRUD
- `unsubscribeFeed()` 除了删 codoc 文件，必须同步清除 `.source-state.json` 中对应 NodeId 的条目（当前 delete codoc 只删文件和编译产物，不清理 source-state，会留下 orphan state）
- 保留旧的 index-based PATCH route 做兼容，新 UI 全部切到 articleId

**URL 变更的状态迁移语义：**

改 feed URL 不是普通的字段编辑——当前 merge 逻辑会保留"新 feed 里没出现的旧文章"，`.source-state.json` 按 NodeId 索引且 NodeId 不因 URL 变更而改变。如果不做处理，旧 feed 的缓存和健康状态会残留。

规则：**变更 URL = 原地重建订阅。** 采用 validate-then-commit 策略（先验证再提交，避免回滚复杂性）：
1. 用新 URL 执行一次试探性 fetch（不写入任何持久状态）
2. 如果 fetch 失败，直接返回错误，codoc 和 source-state 均不变
3. fetch 成功后，原子提交：
   - 更新 codoc 文件中的 `$source.url` 参数
   - 清空该 NodeId 的 cachedValue、lastError、consecutiveFailures
   - 将 lastFetchedAt 置为当前时间（刚刚成功拉取过）
   - 将试探 fetch 的结果写入 cachedValue（避免重复拉取）

这也是为什么 URL 变更独立为 `PUT .../url` 而非包含在普通 PATCH 中——语义不同，副作用不同。

**验收：**
- 订阅、取消订阅、单 feed 刷新、全量刷新、digest、saved 都能走 REST
- 前端不再依赖 prompt 完成核心动作

---

### WF-3: Feed 健康与失败可见性

**状态扩展（`.source-state.json` per NodeId）：**

```typescript
interface SourceEntryState {
  lastFetchedAt: string | null;    // 已有
  lastAttemptAt: string | null;    // 新增
  lastError: string | null;        // 新增
  consecutiveFailures: number;     // 新增
  cachedValue?: unknown;           // 已有
}
```

**调度器行为修改（source-scheduler.ts）：**
- 每次尝试刷新写 lastAttemptAt
- 成功时清空 lastError，consecutiveFailures 归零
- 失败时保留上次成功数据，更新 lastError 和失败计数
- refreshFeeds() 返回结构化失败信息

**UI 最低要求：**
- healthy / failing / never-fetched 状态标识
- 最后成功时间
- 最后错误摘要
- 手动重试按钮

**验收：**
- 故意给一个坏 feed，用户能看懂哪个 feed 坏了、为什么坏、上次成功是什么时候
- 全量 refresh 不会把"部分成功、部分失败"压成一条无意义提示

---

### WF-4: RSS 专属 UI 结构

从"codoc 文件浏览器碰巧显示了 RSS"升级成产品面板。

**中心视图：**

| 视图 | 定位 |
|------|------|
| Inbox | 默认首页，highlights + trending + digest 时间线 |
| Subscriptions | 订阅管理——列表、健康、未读数、刷新、编辑、删除、添加 |
| Saved | 全局 starred articles，支持搜索 |
| Feed detail | 保留现有 source codoc 页面，更像阅读页 |

**⚠️ 这是 app-shell 级平台改造，不是 RSS 子树内部的小改动。**

当前前端 navigation model：
- Focus 是封闭 union：`codoc | graph | component | none`
- `homeView: "inbox"` 只是自动选中 `inbox.codoc`（仍然走 codoc focus）
- `WorkspaceUiSpec` 只认 `homeView / hiddenPaths / primaryActions`
- 中心面板渲染逻辑完全绑定在 Focus 类型上

要支持 plugin-declared views，需要改造的不只是 spec 类型：

1. **Focus union 开放化** — 增加 `{ kind: "plugin-view"; viewId: string }` 或改为 open discriminant
2. **中心面板 dispatch** — 从 switch(focus.kind) 硬编码改为查表/注册机制
3. **侧边栏导航** — 当前只有 codocs/chats 两个 tab，需要增加 plugin views 的 nav entry
4. **API 类型同步** — `ui/src/api.ts` 的 `WorkspaceUiSpec` 要扩展
5. **Plugin view 渲染** — plugin views 从 API 读数据（不是 codoc 文件），组件打包在 app-shell 中

**平台扩展（WorkspaceUiSpec）：**

```typescript
interface WorkspaceUiSpec {
  // ...existing
  secondaryViews?: readonly {
    id: string;
    label: string;
    icon?: string;
  }[];
}
```

设计为 generic，不 over-fit RSS——未来其他 plugin 直接复用。但实施时必须同步改造 Focus type、center panel dispatch、sidebar navigation。

**新增 UI focus：** `rss-subscriptions`、`rss-saved`（作为 `plugin-view` kind 的实例）

**新增组件目录：** `apps/local/ui/src/components/rss/`（创建时同步写 AGENTS.md）

关键组件：
- SubscriptionsPanel.tsx
- SubscriptionForm.tsx（添加/编辑）
- SavedArticlesPanel.tsx
- FeedStatusBadge.tsx

**注意：** Subscriptions / Saved 是 app-shell views（从 API 读数据），不是 workspace-local MDX 组件，不走 template-copy。

**验收：**
- 用户不需要进 sources/ 管理订阅
- Saved articles 有专门入口
- 订阅管理、阅读、保存形成完整产品路径

---

### WF-5: 订阅管理与文章交互升级

**订阅管理：**
- 添加 feed：URL 校验 + 重复检测 + slug 冲突处理 + 初次拉取验证
- 编辑 feed：title / whyFollow / interval（**不含 URL**，URL 变更走独立 `PUT .../url` 流程，见 WF-2）
- 删除 feed：确认 + 删除后刷新视图

**文章交互：**
- Feed 页：all / unread / starred 筛选 + 关键词搜索 + 最近 N 天
- Saved 页：搜索 + 按来源过滤 + 取消收藏
- 所有状态写入切到 articleId

**模板同步问题：**

ArticleList.tsx 是 template-copy 到 workspace 的，改模板不影响已有 workspace。

当前 `add.ts` 的设计契约是 **不覆盖已存在的文件**（显式 `stat()` 检查 + skip log），因为用户可能有定制。激活时静默覆盖会破坏这个契约。

**方案：显式迁移，而非静默同步。**

1. 组件文件头部写入版本标记：`// @managed-by: rss-plugin v<N>`
2. plugin 激活时检查已有组件：
   - 有 `@managed-by` 标记且版本低于当前 → 自动升级（用户未定制）
   - 有 `@managed-by` 标记但被用户修改（hash 不匹配）→ 跳过，log warning
   - 无 `@managed-by` 标记（老 workspace）→ **不覆盖**，在 UI 中提示"RSS 组件有更新可用"
3. 用户确认后执行升级（或提供 CLI 命令 `codoc rss migrate-components`）

这不是通用迁移框架——只是 RSS vertical 的一次定向升级，但尊重"用户文件不被静默覆盖"的基本契约。

可能新增 `apps/local/src/plugins/rss/sync.ts`。

**验收：**
- 新老 RSS workspace 都能用新版 article interaction
- 用户能在 feed 里做基本 triage

---

### WF-6: Digest 质量与自动化

**第一层：deterministic 质量**
- 选文 ranking signals：recency + unread + starred + source diversity（不只按时间）
- summary：从 description/content 提取干净摘要，不简单回退标题
- trending：明确"关注度更高的候选"，不只是下一批文章

**第二层：AI 增强（可选）**
- provider 可用时：AI 重写 highlights one-line summary
- provider 不可用时：退回 deterministic summary
- 内部结果可观测，UI 不暴露 AI 状态

**自动化：**
- RSS plugin 通过 `startJobs()` 注册 digest job，返回 PluginJobHandle
- 配置：`autoDigest: boolean`、`digestIntervalMinutes: number`
- 结果写回 inbox.codoc.lastDigestAt
- UI 需处理 live update（已有 `codoc-updated` SSE event）

**生命周期约束：**

当前 plugin jobs 在 workspace activate 时启动（`http-server.ts:143`），teardown 时停止（`http-server.ts:649`）。auto digest 仅在本地 server 运行期间有效。

这意味着：
- 产品承诺是"server 运行期间，用户无需手动触发即可获得新 digest"
- **不是**"用户随时回来都有最新 digest"——如果 server 停了，digest 也停了
- 如果未来要突破这个限制（真正的"离线积累"），需要 OS-level 调度（launchd / cron），属于 M3 之外的能力

M3 scope 内的合理承诺：workspace 打开期间，digest 自动周期更新；workspace 重新打开时，先触发一次 refresh + digest catch-up。

**验收：**
- digest 不是简单标题堆砌
- server 运行期间，不开 chat 也能看到新 digest（周期自动生成）
- workspace 重新打开后，首次 digest 在 scheduler ready 后自动触发
- provider 不可用时 RSS workspace 仍完全可用

---

## 里程碑

### M1：可推荐给愿意试新工具的工程同事

包含：WF-1 + WF-2 + WF-3

交付物：
- 稳定 articleId
- 完整 subscriptions API
- feed 健康状态持久化 + UI 展示

实施建议：WF-1/2/3 作为一个分支实现——域模型、API、健康状态紧耦合，分开做会重复触碰同一批文件。

### M2：可推荐给一般工程同事日用

包含：WF-4 + WF-5

交付物：
- **平台层**：Focus 开放化 + plugin-view dispatch + sidebar nav 扩展
- **RSS 层**：Subscriptions / Saved 专属视图
- 订阅全生命周期管理 UI
- 文章筛选/搜索
- 老 workspace RSS 资产显式迁移

实施顺序：先做平台骨架（Focus + dispatch + nav），再填 RSS 具体视图——否则每个视图都在 hack 封闭 union。

### M3：能稳定扩散的内部 RSS 产品

包含：WF-6

交付物：
- 多维 digest ranking
- AI 增强摘要（graceful degrade）
- 自动 digest job

---

## 实施注意事项

1. **`.source-state.json` 迁移**：新增字段默认 null/0，无需版本标记，缺失字段 graceful fallback
2. **并发刷新**：refreshAllSources 当前串行 fetch，M1 中改为 concurrency limit = 3 的并行。**注意**：当前 state 写入模式是"读整个文件 → 改一项 → 写回整个文件"（`workspace-service.ts:65-73`），串行时安全，并发时多个 refresh 会互相覆盖。并发化时必须同步解决：加 state 写入 mutex（推荐，最简单）、或改为批量提交（tick 结束后一次性写回所有变更）
3. **搜索**：M2 的搜索为客户端侧过滤（文章量 <2000），不建库
4. **错误展示**：refresh 结果从单条 toast 改为 per-feed 结构化展示（可展开列表）
5. **secondaryViews 是平台改造**：涉及 Focus type 开放、center panel dispatch、sidebar nav、API 类型——先做平台骨架再填 RSS 具体视图
6. **组件升级尊重用户文件**：不静默覆盖，用 `@managed-by` 标记区分受管文件和用户定制文件
7. **URL 变更 = 状态重置**：PATCH subscription 不包含 URL，URL 变更走独立 PUT 端点并触发 cache/state 清空
8. **auto digest 受限于 server 生命周期**：不做 OS-level 调度，但 workspace 重开时做一次 catch-up
