# RSS 体验补齐 — 从 Agent 到 Reader

## 背景

对比传统 RSS Client（Feedly, Inoreader 等），当前 RSS Agent 在"深度理解和知识沉淀"上有独特优势，但在高频基础操作上体验差距明显。本任务聚焦补齐 4 个核心体验短板。

---

## F1: 未读状态管理

### 问题
当前文章无 read/unread 状态。用户无法区分哪些是新内容、哪些已看过。这是 RSS 最基本的交互。

### 设计

**数据层：** 在 codoc `data.articles[]` 中增加 `readAt` 字段（ISO timestamp | null）。

```yaml
data:
  articles:
    - title: "..."
      link: "https://..."
      readAt: null          # 未读
    - title: "..."
      link: "https://..."
      readAt: "2026-04-07"  # 已读
```

**为什么不用独立表：** 文章是 codoc data 的一部分，用 codoc 自身存储最简单，不需要额外的 join 逻辑。未来多用户场景再考虑独立表。

**交互层：** 新增 view action type `patch`，允许前端直接修改 codoc data 的某个字段。

```typescript
interface ViewAction {
  type: "chat" | "patch";
  prompt?: string;            // chat type
  path?: string;              // patch type: data path to update
  value?: unknown;            // patch type: new value
}
```

**前端：** 点击文章时触发 `patch` action，设置 `readAt` 为当前时间。未读文章在 timeline view 中显示高亮样式。

### 改动范围

| 文件 | 改动 |
|------|------|
| `apps/web/src/types.ts` | ViewAction 新增 `patch` type |
| `apps/web/src/components/view-renderer.tsx` | 处理 patch action，未读高亮样式 |
| `apps/web/src/pages/chat-page.tsx` | handleViewAction 增加 patch 分支，调 updateCodoc API |
| `packages/agent/src/rss-agent.ts` | system prompt 中文章模板增加 `readAt: null`；view template 中增加 patch action |

---

## F2: 自动定时刷新

### 问题
用户每次需要手动在 chat 中说"刷新"，没有后台自动拉取。打开 RSS 面板时看到的是上次手动刷新的旧数据。

### 设计

**方案：Server 进程内定时轮询。**

不引入外部 job queue（过重），用简单的 `setInterval` + 数据库状态驱动：

1. 每个 RSS codoc 的 data 中已有 `lastFetchedAt`
2. 新增 `refreshIntervalMinutes` 字段（默认 60）
3. Server 启动时开一个定时循环（每 5 分钟检查一次）
4. 查找所有 `tags: [rss]` 的 codoc，对比 `lastFetchedAt + refreshInterval < now` 的执行刷新
5. 刷新逻辑复用 agent 的 `fetchRssFeed` tool 中的 RSS 解析逻辑（提取为 shared util）

**关键：刷新不走 agent，而是直接的 service 层操作。** Agent 是对话驱动的，定时任务应该是纯数据操作。

### 改动范围

| 文件 | 改动 |
|------|------|
| `packages/agent/src/rss-agent.ts` | 提取 RSS fetch/parse 为独立 util |
| `packages/service/src/rss-refresh.ts` | 新文件：RSS 刷新逻辑（fetch → merge articles → update codoc） |
| `apps/server/src/rss-scheduler.ts` | 新文件：定时器，定期调用 service 刷新 |
| `apps/server/src/index.ts` | 启动/停止 scheduler |
| `packages/agent/src/rss-agent.ts` | system prompt 中 codoc 模板增加 `refreshIntervalMinutes` |

---

## F3: 订阅管理面板

### 问题
管理订阅完全依赖 chat 对话，没有可视化的 feed 列表。用户无法一眼看到自己订阅了什么、每个源有多少未读。

### 设计

**在 workspace 侧边栏增加 RSS feeds 分区：**

```
┌─ Workspace ──────────────┐
│                          │
│  📄 Codocs               │
│    rss/hn-best.codoc     │
│    rss/tech-weekly.codoc │
│    notes/meeting.codoc   │
│                          │
│  📡 RSS Feeds            │  ← 新增分区
│    Hacker News Best  (3) │  ← feed 名 + 未读数
│    Tech Weekly       (0) │
│    Design Digest     (5) │
│                          │
│  💬 Chat                 │
└──────────────────────────┘
```

**实现：**
- 从 `listCodocs` 结果中过滤 `meta.tags` 包含 `rss` 且 path 以 `rss/` 开头（排除 `rss/summaries/`）
- 未读数从 codoc 的 `resolvedValue.data.articles` 中统计 `readAt === null` 的数量
- 点击 feed 条目 → 在 canvas 中打开该 codoc

### 改动范围

| 文件 | 改动 |
|------|------|
| `apps/web/src/components/rss-feed-list.tsx` | 新文件：RSS feed 列表组件 |
| `apps/web/src/pages/chat-page.tsx` | 在侧边栏引入 RSS feed list |

---

## F4: 文章列表快速浏览

### 问题
timeline view 中所有文章平铺展示，缺少快速扫描和交互。传统 RSS 客户端支持展开/折叠、键盘导航、快速标记已读。

### 设计

**增强 timeline view 的交互能力：**

1. **展开/折叠：** 文章默认只显示标题行，点击展开显示摘要
2. **已读样式：** 已读文章标题灰色、字重降低
3. **批量标已读：** view action `patch-all` — 一键将所有文章标为已读
4. **键盘导航：** j/k 上下移动焦点，Enter 展开/折叠，m 标记已读

### 改动范围

| 文件 | 改动 |
|------|------|
| `apps/web/src/components/view-renderer.tsx` | timeline 节点增加折叠状态、已读样式、键盘事件 |
| `apps/web/src/types.ts` | ViewAction 增加 `patch-all` type |
| `apps/web/src/pages/chat-page.tsx` | handleViewAction 处理 `patch-all` |

---

## 依赖关系与实施顺序

```
F1 (未读状态)  ← 基础，F3/F4 都依赖它
  ↓
F2 (自动刷新)  ← 独立，但刷新后需要保留 readAt 状态
  ↓
F3 (管理面板)  ← 依赖 F1 的未读数
  ↓
F4 (快速浏览)  ← 依赖 F1 的已读样式 + F3 的面板入口
```

建议顺序：**F1 → F2 → F3 → F4**

---

## 不做的事情

- **不做跨设备同步** — 单用户场景，数据在同一个 PostgreSQL
- **不做 RSS 发现/推荐** — 用户自己提供 feed URL
- **不做 OPML 导入导出** — 当前订阅数量少，手动管理可接受
- **不做离线阅读** — web app，假设有网络
