# RSS Agent v2 — 从"标题浏览器"到"阅读助手"

## 现状

RSS agent 能跑通基本链路：`@rss <feed-url>` → 列出条目 → 讨论 → 存 codoc。但从日常使用角度有三个硬伤，按优先级排列。

---

## P0: 内容太薄，总结无信息增量

### 问题

大多数 RSS feed 的 `description/content` 字段只有标题或一两句摘要。LLM 基于这些信息生成的"总结"本质上是对标题的改写，没有从原文中提取出新信息。

实测 Anthropic Research feed：
```
summary: "Mar 24, 2026Economic ResearchAnthropic Economic Index report: Learning curves"
```
这不够用。

### 设计

新增 `fetchWebPage` tool，agent 在用户选择条目后自动 fetch 原文。

**Tool 定义：**
```typescript
{
  name: "fetchWebPage",
  input: { url: string },
  output: { url: string, content: string }  // 原始 HTML/text，交给 LLM 提取
}
```

**实现：** 用 Node.js 内置 `fetch()` 获取页面 HTML，做基础清理（去 script/style 标签），截断到合理长度（~50k chars）避免 token 爆炸。不需要 headless browser，不需要 readability 库。

**流程变化：**
```
之前：用户选条目 → LLM 基于 feed snippet 总结（信息量 ≈ 0）
之后：用户选条目 → agent 调 fetchWebPage 获取原文 → LLM 基于原文总结
```

**改动范围：**

| 文件 | 改动 |
|------|------|
| `packages/agent/src/tools.ts` | 新增 `fetchWebPage` tool 定义 + 执行逻辑 |
| `packages/agent/src/rss-agent.ts` | tools 列表加入 `fetchWebPage`；system prompt 引导 agent 在用户选条目后主动 fetch 原文 |

---

## P1: 每次手动输入 feed URL

### 问题

真实用户有 5-20 个固定订阅源。每次都要粘完整 URL 不现实。

### 设计

利用 `agent_sessions.state` (JSONB) 存储订阅列表。新增两个 tool 管理订阅。

**State 结构：**
```typescript
// agent_sessions.state 的 RSS 部分
interface RssState {
  feeds: Array<{
    url: string;
    title: string;      // 首次 fetch 后自动填充
    alias?: string;      // 用户自定义别名
    addedAt: string;     // ISO date
  }>;
}
```

**新增 tools：**

| Tool | 输入 | 行为 |
|------|------|------|
| `manageRssFeeds` | `{ action: "add" \| "remove" \| "list", url?: string, alias?: string }` | 增删查订阅源，持久化到 session state |

**交互方式：**
```
@rss 订阅 https://anthropic.com/feed.xml 别名 anthropic
@rss 列出订阅
@rss                          ← 无参数 = 拉取所有订阅源
@rss anthropic                ← 按别名拉取单个源
```

不需要在消息解析层做特殊处理 — 这些都是自然语言，LLM 通过 system prompt 理解意图并调用对应 tool。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `packages/agent/src/types.ts` | `AgentContext` 新增可选 `sessionRepo` 字段 |
| `packages/agent/src/tools.ts` | 新增 `manageRssFeeds` tool 定义 + 执行逻辑（读写 session state） |
| `packages/agent/src/rss-agent.ts` | tools 列表加入 `manageRssFeeds`；system prompt 描述订阅管理能力 |
| `apps/server/src/routes/chat-routes.ts` | 构建 AgentContext 时传入 `sessionRepo` |

---

## P2: 没有"新文章"概念

### 问题

每次返回 feed 全部条目，用户反复看到相同内容。

### 设计

在 P1 的 state 结构上扩展，记录每个 feed 的最后查看时间。

**State 扩展：**
```typescript
interface RssState {
  feeds: Array<{
    url: string;
    title: string;
    alias?: string;
    addedAt: string;
    lastSeenAt?: string;   // ← 新增：上次查看时间 ISO date
  }>;
}
```

**逻辑：**
- `fetchRssFeed` 返回结果后，agent 对比 `item.pubDate` 和 `lastSeenAt`
- 优先展示新条目，旧条目折叠（"另有 N 篇已读"）
- 每次查看后自动更新 `lastSeenAt` 为当前时间

不需要逐条记录已读（太重），按时间水位线过滤足够。

**改动范围：**

与 P1 共享基础设施，额外改动：

| 文件 | 改动 |
|------|------|
| `packages/agent/src/tools.ts` | `fetchRssFeed` 执行后调用 session state 更新 `lastSeenAt` |
| `packages/agent/src/rss-agent.ts` | system prompt 引导 agent 区分新旧条目的展示方式 |

---

## 依赖关系

```
P0 (fetchWebPage)     ← 独立，可先做
P1 (订阅管理)          ← 需要 AgentContext 扩展
P2 (新文章过滤)        ← 依赖 P1 的 state 基础设施
```

建议实施顺序：P0 → P1 → P2。P1 和 P2 可以合并为一个 PR，因为共享 state 结构设计。

---

## 不做的事情

- **不做 feed 自动发现**（输入博客 URL 自动找 feed）— 过早优化
- **不做定时拉取** — 当前是用户主动 @rss 触发，够用
- **不做 OPML 导入导出** — 等用户有需求再加
- **不做全文搜索** — codoc 本身的能力来覆盖
