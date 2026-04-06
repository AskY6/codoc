# RSS Agent — User Story

## Overview

RSS Agent 是一个专用于 RSS 订阅管理的 AI 助手。核心设计原则：**codoc 即订阅**——每个 RSS 订阅以 `rss/<slug>.codoc` 的形式存储在数据库中，无需独立的订阅表。

---

## User Stories

### US-1: 订阅 RSS 源

**As** 用户
**I want** 通过聊天告诉 RSS Agent 一个 feed URL
**So that** 系统为我创建一个 codoc 来持续追踪该源的文章

**Acceptance Criteria:**

- [ ] 用户发送类似「订阅 https://example.com/feed」的消息
- [ ] Agent 调用 `listCodocs` 检查是否已存在相同 feed URL 的订阅（匹配 `meta.description`）
- [ ] 若已存在，提示用户已订阅，不重复创建
- [ ] 若不存在，调用 `fetchRssFeed`（不带 `lastFetchedAt`）拉取全量文章
- [ ] 调用 `createCodoc` 创建 `rss/<slug>.codoc`，结构包含：
  - `meta.title` = feed 标题
  - `meta.tags` = `[rss]`
  - `meta.description` = feed URL（用于去重匹配）
  - `data.feedUrl`, `data.feedTitle`, `data.lastFetchedAt`, `data.articles`
  - `view` 使用 `timeline` + `repeat/template` 渲染文章列表
- [ ] Agent 向用户确认订阅成功，展示新文章数量

---

### US-2: 列出所有订阅

**As** 用户
**I want** 查看当前 workspace 下的所有 RSS 订阅
**So that** 我能了解自己关注了哪些信息源

**Acceptance Criteria:**

- [ ] 用户发送「列出订阅」或类似指令
- [ ] Agent 调用 `listCodocs`，过滤 path 以 `rss/` 开头且 `meta.tags` 包含 `rss` 的 codoc
- [ ] 返回每个订阅的标题、feed URL（`meta.description`）和 codoc 路径
- [ ] 若无订阅，提示用户暂无订阅

---

### US-3: 刷新 / 阅读订阅

**As** 用户
**I want** 检查某个（或所有）订阅源的最新文章
**So that** 我能获取自上次阅读以来的新内容

**Acceptance Criteria:**

- [ ] 用户发送「刷新 xxx」或「有什么新文章」
- [ ] Agent 调用 `getCodoc` 获取目标 codoc，提取 `data.lastFetchedAt`
- [ ] 调用 `fetchRssFeed` 并传入 `lastFetchedAt`，仅标记新文章 `isNew: true`
- [ ] 调用 `updateCodoc` 更新文章列表和 `lastFetchedAt` 时间戳
- [ ] 向用户展示新文章的简要列表（标题 + 日期 + 摘要）
- [ ] 告知已读文章数量（如「另有 N 篇已读」）
- [ ] fetch 超时限制为 15 秒

---

### US-4: 深度阅读文章

**As** 用户
**I want** 选择某篇文章获取完整内容和总结
**So that** 我不用离开对话就能深入了解文章

**Acceptance Criteria:**

- [ ] 用户指定某篇文章（如点击 view action 或在对话中引用）
- [ ] Agent 调用 `fetchWebPage` 获取文章全文
- [ ] 网页内容经过清洗：剥离 script/style/nav/footer/header 等无关 HTML
- [ ] 内容截断上限 50KB
- [ ] Agent 利用 Claude 能力对文章进行总结

---

### US-5: 取消订阅

**As** 用户
**I want** 取消对某个 RSS 源的订阅
**So that** 不再追踪不感兴趣的源

**Acceptance Criteria:**

- [ ] 用户发送「取消订阅 xxx」
- [ ] Agent 通过 `listCodocs` 定位目标 codoc
- [ ] 调用 `deleteCodoc` 硬删除该 codoc
- [ ] 若有 dashboard codoc 通过 `$ref` 引用了该源，DAG 引擎检测到断引用
- [ ] 向用户确认已取消

---

### US-6: RSS Dashboard（多源聚合）

**As** 用户
**I want** 创建一个聚合多个订阅源的 dashboard
**So that** 我能在一个视图中浏览所有关注领域的文章

**Acceptance Criteria:**

- [ ] 用户发送「创建 RSS 仪表盘」或类似指令
- [ ] Agent 创建 `rss/dashboard.codoc`，使用 `$ref` 引用各个 feed codoc 的 `data.articles`
- [ ] `meta.tags` 包含 `[rss, dashboard]`
- [ ] view 使用 `tabs` 类型，每个 tab 对应一个 feed 源，内部用 `timeline` + `repeat/template`
- [ ] 当任一 feed codoc 更新时，DAG 引擎自动将 dashboard 标记为 dirty 并重新 resolve

---

### US-7: 保存文章总结为 codoc

**As** 用户
**I want** 将深度阅读后的文章总结保存为独立 codoc
**So that** 总结内容可被其他 codoc 引用或后续查阅

**Acceptance Criteria:**

- [ ] 用户阅读文章后指示保存
- [ ] Agent 创建 `rss/summaries/<slug>.codoc`
- [ ] `meta.tags` 包含 `[rss, summary]`
- [ ] `meta.description` = 文章原始 URL
- [ ] `data` 包含 title, link, pubDate, summary
- [ ] view 使用 `stack` + `markdown` 组合渲染

---

## Agent 路由与交互

### 路由机制

| 方式 | 行为 |
|------|------|
| `@rss` 显式提及 | 直接路由到 RSS Agent，跳过 LLM 分类 |
| 单 agent 线程 | 如果线程只关联了 rss agent，自动路由 |
| 隐式路由 | Router Agent 基于消息意图 + codoc 上下文（source codoc 的 meta/tags）分类后委派 |

### 交互约束

- 每条用户消息仅产生一次回复（router 回复或 specialist 回复，不会两者都有）
- 静默路由：用户看不到「转发中」等中间消息
- 每条 assistant 消息携带 `agentId`，前端据此渲染 agent 身份
- 单次消息的工具调用上限为 10 次

### View Action 集成

- feed codoc 的 view 中文章条目可携带 `action.type: chat`
- 点击触发预设 prompt（如「总结这篇文章: {{item.title}}」）
- 前端发送消息时携带 source codoc 上下文，辅助 agent 路由

---

## 数据模型

### Feed Codoc 结构 (`rss/<slug>.codoc`)

```yaml
meta:
  title: "Feed Title"
  tags: [rss]
  description: "https://example.com/feed"   # 兼作 feed URL 标识

data:
  feedTitle: "Feed Title"
  feedUrl: "https://example.com/feed"
  lastFetchedAt: "2026-04-06T10:00:00Z"
  articles:
    - title: "Article Title"
      link: "https://..."
      pubDate: "2026-04-05"
      summary: "..."
      isNew: true

view:
  type: timeline
  repeat:
    bind: data.articles
    as: item
  template:
    type: stack
    action:
      type: chat
      prompt: "Summarize: {{item.title}} ({{item.link}})"
    children:
      - type: text
        props:
          content: "{{item.pubDate}}"
      - type: markdown
        props:
          content: "**{{item.title}}**\n\n{{item.summary}}"
```

### Dashboard Codoc 结构 (`rss/dashboard.codoc`)

```yaml
meta:
  title: "RSS Dashboard"
  tags: [rss, dashboard]

data:
  techArticles:
    $ref: "rss/tech-weekly.codoc#data.articles"
  designArticles:
    $ref: "rss/design-digest.codoc#data.articles"

view:
  type: tabs
  children:
    - type: timeline
      props:
        label: "Tech"
      repeat:
        bind: data.techArticles
        as: item
      template: ...
```

---

## 工具清单

| 工具 | 类型 | 用途 |
|------|------|------|
| `fetchRssFeed` | RSS 专有 | 解析 RSS/Atom feed，返回文章列表，支持 `lastFetchedAt` 增量标记 |
| `fetchWebPage` | RSS 专有 | 抓取网页全文并清洗 HTML，上限 50KB |
| `listCodocs` | 平台通用 | 列出 workspace 下所有 codoc |
| `getCodoc` | 平台通用 | 获取单个 codoc 的内容和 resolvedValue |
| `createCodoc` | 平台通用 | 创建新 codoc（订阅 / dashboard / summary） |
| `updateCodoc` | 平台通用 | 更新 codoc 内容（刷新文章） |
| `deleteCodoc` | 平台通用 | 删除 codoc（取消订阅） |

---

## View 约束

Agent 生成的 view 仅允许使用以下 8 种白名单类型：

`text` · `markdown` · `table` · `stack` · `grid` · `tabs` · `timeline` · `section`

禁止发明 `article-summary`、`card`、`hero`、`quote`、`list` 等自定义类型。复杂布局通过组合基础类型实现。

---

## 回归测试检查点

以下为功能回归时的关键验证点：

### P0 — 核心路径

1. [x] **订阅**: 发送 feed URL → codoc 创建成功 → path 为 `rss/*.codoc` → `meta.tags` 含 `rss` → `meta.description` 为 feed URL
2. [x] **去重**: 重复订阅同一 URL → 不创建新 codoc → 提示已存在
3. [x] **刷新**: 对已订阅的 feed 刷新 → `lastFetchedAt` 更新 → 新文章标记 `isNew: true`
4. [x] **取消订阅**: 删除 codoc → `listCodocs` 不再返回该条目
5. [x] **路由**: `@rss` 消息 → 由 RSS Agent 处理 → 响应携带正确 `agentId`

### P1 — 数据完整性

6. [x] **codoc 结构**: 创建的 codoc YAML 可被 parser 正确解析，无 schema 错误
7. [x] **view 白名单**: codoc view 仅使用 8 种允许的 type，保存时不产生 parse error
8. [x] **repeat/template**: view 中使用 `repeat` + `template` 而非硬编码文章子节点（timeline view 正确渲染）
9. [ ] **DAG $ref**: dashboard codoc 的 `$ref` 指向有效的 feed codoc path，resolve 后 data 正确

### P1.5 — 扩展路径

10. [x] **隐式路由**: 不使用 `@rss`，发送 RSS 相关消息 → Router 自动分类委派给 RSS Agent
11. [x] **深度阅读**: 请求阅读某篇文章 → `fetchWebPage` 获取全文 → Agent 生成结构化总结
12. [x] **保存摘要**: 深度阅读后保存 → 创建 `rss/summaries/*.codoc` → tags 含 `[rss, summary]`
13. [x] **codoc view 渲染**: codoc 弹窗正确展示 timeline 视图（日期 + 标题 + 摘要卡片）
14. [x] **DAG Graph 视图**: workspace Graph tab 正确显示 codoc 节点，Ready 状态绿色

### P2 — 边界情况

15. [ ] **fetch 超时**: feed URL 不可达时 15 秒超时，Agent 返回友好错误
16. [ ] **无效 URL**: 非 RSS/Atom 格式的 URL → Agent 提示格式不匹配
17. [ ] **空 feed**: feed 无文章 → codoc 创建成功，articles 为空数组
18. [ ] **大页面**: `fetchWebPage` 内容超 50KB → 截断处理
19. [ ] **断引用**: 删除被 dashboard 引用的 feed codoc → DAG 引擎检测到 broken ref

---

## E2E 验证记录

> 最近一次验证: 2026-04-06，使用 agent-browser 对 localhost:5173 进行端到端测试

| # | 测试场景 | 结果 | 备注 |
|---|---------|------|------|
| 1 | 订阅 Ars Technica feed | PASS | codoc `rss/arstechnica.codoc` 创建，20 篇文章，timeline view 渲染正常 |
| 2 | 列出所有订阅 | PASS | 返回表格含标题、Feed URL、路径 |
| 3 | 重复订阅同一 URL | PASS | 提示「你已经订阅了这个 Feed!」，未创建重复 codoc |
| 4 | 刷新订阅 | PASS | `lastFetchedAt` 更新，显示「没有新文章，另有 20 篇已读」 |
| 5 | 取消订阅 | PASS | codoc 硬删除，workspace codoc 列表清空 |
| 6 | 隐式路由订阅 HN | PASS | 无 @rss 提及，Router 自动路由到 RSS Reader |
| 7 | 深度阅读文章 | PASS | fetchWebPage + 结构化总结（核心要点/功能亮点/关键洞察） |
| 8 | 保存文章摘要 | PASS | `rss/summaries/gemma-4-on-iphone.codoc`，tags: [rss, summary] |
| 9 | Codoc View 弹窗 | PASS | timeline 视图正确渲染文章卡片 |
| 10 | DAG Graph 视图 | PASS | 两节点独立显示，Ready 状态 |
