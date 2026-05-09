# RSS Workspace — User Story

> 完整的用户操作路径，用于端到端体验走查和持续优化。

---

## Persona

**小明** — 一个关注技术动态的工程师。他希望有一个 AI 助手帮他跟踪 RSS 订阅源，每天给他做摘要，并能按主题做深度调研。他不想自己刷 feed，而是让 AI 代劳。

---

## Story 0: 首次启动（冷启动）

### 0.1 启动 codoc server

```
codoc serve
# → [codoc] server listening on http://localhost:4321
# → [codoc] UI: http://localhost:4321
```

- 打开浏览器，进入 workspace picker 页面
- 此时没有任何 workspace，看到「Get started with a template」的空状态

### 0.2 从模板创建 RSS workspace

1. 在 workspace picker 中点击 **RSS Reader** 模板卡片
2. 弹出对话框，输入 workspace 名称（如 `my-feeds`），点击 Create
3. 系统自动：
   - 在 `~/.codoc/my-feeds/` 创建目录
   - 写入 `codoc.config.json`（含 commands、quickActions、agentInstructions）
   - 生成初始文件：
     - `inbox.codoc` — 空的收件箱视图
     - `sources/hacker-news.codoc` — HN feed（interval: 30）
     - `sources/simon-willison.codoc` — Simon Willison's blog
     - `sources/github-engineering.codoc` — GitHub Engineering blog
     - `guide.codoc` — 使用指南
   - 安装自定义组件：`ArticleList.tsx`、`FeedHeader.tsx`
   - 首次 resolve：立即拉取所有 feed 的文章
   - 启动 source scheduler（每 60s 检查是否有到期的 periodic source）
   - 启动 file watcher
   - 设置 MCP server
4. 自动进入 workspace 主界面

### 0.3 首次进入 workspace — 用户看到什么

**左侧栏：**
- Workspace 标题 `my-feeds`
- Codocs tab（默认选中）：
  - `guide.mdx`
  - `inbox.mdx`
  - `sources/` 文件夹
    - `github-engineering.mdx`
    - `hacker-news.mdx`
    - `simon-willison.mdx`
- Chats tab（空）
- 底部：Graph / Components / Chat 三个快捷入口

**中央区域：**
- 空状态：「Select a codoc to begin」

**验证点：**
- [ ] workspace picker → 模板创建流程是否顺畅
- [ ] 首次 resolve 完成后，feed 数据是否已被拉取
- [ ] file tree 是否正确展示所有文件

---

## Story 1: 浏览 Feed（被动消费）

### 1.1 查看单个 Feed

1. 在左侧 file tree 中点击 `sources/hacker-news.mdx`
2. 中央区域切换为 DocumentPanel，展示：
   - **Preview tab**：渲染 MDX 内容
     - `<FeedHeader>` 组件：显示 "Hacker News"、文章数量、未读数量、刷新频率（every 30m）、feed URL
     - `<ArticleList>` 组件：显示文章列表，每篇带蓝色圆点（未读）、标题链接、发布日期
   - **Data tab**：显示各字段的类型和解析结果
     - `title` — static, "Hacker News"
     - `feedUrl` — static, URL
     - `whyFollow` — static, 描述
     - `articles` — source (rss), resolved 为数组
   - **Editor tab**：显示 `.codoc` 源码（YAML + MDX）

### 1.2 查看 inbox（空状态）

1. 点击 `inbox.mdx`
2. Preview 显示空状态 Card："Your inbox is empty — Ask the agent: 'what's new today?' or 'refresh my feeds and give me a digest'"

### 1.3 查看 guide

1. 点击 `guide.mdx`
2. Preview 展示使用说明和 `<Prompt>` 组件按钮：
   - "What's new today?"
   - "Deep dive into AI agents"
   - "Refresh all feeds"
   - "Subscribe to https://example.com/feed"
   - "Summarize the latest from Hacker News"

### 1.4 查看关系图

1. 点击左侧底部 **Graph** 按钮
2. 中央切换为 GraphPanel，展示所有 codoc 及其字段的 DAG 关系
3. 可以看到 `sources/*.codoc` 各自独立（无 ref 连接），`inbox.codoc` 也独立

**验证点：**
- [ ] FeedHeader 是否正确显示 articleCount 和 unreadCount
- [ ] ArticleList 中所有文章是否为蓝色未读状态
- [ ] 文章链接是否可点击、在新窗口打开
- [ ] Data tab 中 articles 字段 kind 应显示 source
- [ ] Graph 节点是否完整

---

## Story 2: 与 Agent 对话（主动消费）

### 2.1 发起对话 — "今天有什么新内容？"

1. 点击左侧底部 **Chat** 按钮，打开右侧 ChatPanel
2. 或点击 guide 中的 `<Prompt label="What's new today?" />` 按钮
3. Agent 收到 prompt，通过 MCP 工具执行：
   - `list_codocs` — 发现 sources 下的 feed
   - `read_codoc("sources/hacker-news.codoc")` — 读取文章列表
   - `read_codoc("sources/simon-willison.codoc")` — 读取文章列表
   - `read_codoc("sources/github-engineering.codoc")` — 读取文章列表
   - 分析所有 `readAt === null` 的文章，选出 highlights
   - `update_data_field("inbox.codoc", "highlights", [...])` — 写入摘要
   - `update_data_field("inbox.codoc", "lastDigestAt", "2026-04-26T...")` — 记录时间
4. 用户在 chat 中看到 agent 的文字回复："Here are today's highlights..."

### 2.2 查看生成的 Digest

1. 点击 `inbox.mdx`
2. Preview 现在显示：
   - `<Table>` 组件展示 highlights 列表（标题、来源、摘要）
   - 如果有 trending，下方展示 Trending 部分

### 2.3 标记已读

1. 在 chat 中告诉 agent："Mark the top 3 as read"
2. Agent 执行：
   - `read_codoc("sources/hacker-news.codoc")` — 获取文章
   - 对前 3 篇文章调用 `update_data_field` 设置 `readAt` 为 ISO 时间戳
   - 或者一次性更新整个 articles 数组
3. 下次查看 hacker-news feed 时，这 3 篇的圆点从蓝色变为灰色

**验证点：**
- [ ] Chat panel 是否正确打开
- [ ] Agent 是否能读取 feed 数据
- [ ] inbox 的 highlights 是否被写入并渲染
- [ ] readAt 标记后 ArticleList 是否正确显示灰色圆点
- [ ] scheduler merge 是否保留了 readAt（下次 refresh 不丢失已读状态）

---

## Story 3: 订阅新 Feed

### 3.1 通过 Chat 订阅

1. 在 chat 中说："Subscribe to https://blog.rust-lang.org/feed.xml"
2. Agent 执行：
   - `write_codoc("sources/rust-blog.codoc", "---\nmeta:\n  title: Rust Blog\n  tags: [source, rss]\n  description: https://blog.rust-lang.org/feed.xml\ndata:\n  title: Rust Blog\n  feedUrl: https://blog.rust-lang.org/feed.xml\n  whyFollow: Official Rust programming language blog.\n  articles:\n    $source: rss\n    url: https://blog.rust-lang.org/feed.xml\n    interval: 30\n---\n\n<FeedHeader ... />\n<ArticleList items={data.articles ?? []} />")`
3. 系统自动：
   - Parse + validate 新文件
   - 首次 resolve → 拉取 Rust Blog 的 feed
   - 编译为 `sources/rust-blog.mdx`
   - Scheduler 自动发现新的 periodic source（下次 tick 开始跟踪）
4. 左侧 file tree 自动刷新，出现 `sources/rust-blog.mdx`

### 3.2 通过 guide 中的 Prompt 订阅

1. 查看 guide.codoc，点击 `<Prompt label="Subscribe to https://example.com/feed" />`
2. 自动打开 chat，发送该 prompt
3. Agent 询问 feed URL（或直接使用 prompt 中的 URL）
4. 同上流程

**验证点：**
- [ ] 新 codoc 文件结构是否正确（meta.tags 包含 source, rss）
- [ ] articles 字段是否正确声明为 `$source: rss` with `interval: 30`
- [ ] 首次 resolve 是否成功拉取文章
- [ ] file tree 是否自动更新
- [ ] scheduler 是否在下次 tick 时发现并开始跟踪新 source

---

## Story 4: 深度调研（Deep Dive）

### 4.1 发起深度调研

1. 在 chat 中说："Deep dive into AI agents across my feeds"
2. Agent 执行：
   - 读取所有 feed 的文章
   - 搜索与 "AI agents" 相关的文章
   - 综合多篇文章，生成研究笔记
   - `write_codoc("topics/ai-agents.codoc", "...")` — 创建研究笔记
3. 左侧 file tree 出现 `topics/` 目录和 `ai-agents.mdx`

### 4.2 查看调研结果

1. 点击 `topics/ai-agents.mdx`
2. Preview 展示结构化的调研报告：
   - 关键发现
   - 相关文章引用
   - 趋势分析

**验证点：**
- [ ] topics/ 目录是否被正确创建
- [ ] 调研文档的 MDX 是否能正确渲染
- [ ] 文档是否引用了实际的 feed 文章
- [ ] Graph 中是否能看到新节点

---

## Story 5: 日常使用（第 N 天）

### 5.1 早间检查（典型日常动作）

1. 打开 codoc UI（server 已在后台运行）
2. workspace 已打开（上次使用的 `my-feeds`）
3. Scheduler 持续运行 → 所有 feed 每 30 分钟自动刷新
4. 点击 inbox → 查看上次的 digest（如果有）
5. 打开 chat，说 "What's new since yesterday?"
6. Agent 检查所有 feed 中 pubDate 在昨天之后且 readAt === null 的文章
7. 更新 inbox 的 highlights

### 5.2 快速浏览某个 Feed

1. 直接点击 `sources/hacker-news.mdx`
2. 查看最新文章列表
3. 看到有趣的文章 → 点击标题 → 在新 tab 打开原文
4. 回来告诉 agent："Summarize the article about X"

### 5.3 管理订阅

**取消订阅：**
1. 在 file tree 中右键（或 hover 出 delete 按钮）`sources/some-feed.mdx`
2. 确认删除 → codoc 和 compiled output 都被移除
3. Scheduler 下次 tick 自动不再跟踪该 source

**调整刷新频率：**
1. 在 chat 中说："Change hacker-news refresh interval to 60 minutes"
2. Agent 执行 `update_data_field("sources/hacker-news.codoc", "articles", { $source: "rss", url: "...", interval: 60 })`
3. 下次 scheduler tick 使用新的 interval

### 5.4 切换 / 创建 workspace

1. 点击左上角 workspace 名称 → 回到 workspace picker
2. 可以创建新的 workspace（空白或从模板）
3. 可以重命名 / 删除已有 workspace

**验证点：**
- [ ] 长时间运行后 scheduler 是否正常工作
- [ ] merge 是否持续保留 readAt/starred 状态
- [ ] 删除 codoc 后 file tree 和 DAG 是否更新
- [ ] workspace 切换是否正确释放旧 scheduler 并启动新 scheduler

---

## Story 6: 编辑与自定义

### 6.1 编辑 codoc 源码

1. 选中某个 codoc → 切换到 Editor tab
2. 修改 YAML frontmatter 或 MDX body
3. 保存 → 触发 re-parse、re-resolve、re-compile
4. Preview 自动更新

### 6.2 查看 / 创建自定义组件

1. 点击左侧底部 **Components** 按钮
2. ComponentPanel 展示 builtin 组件（Table、Card、Chart、Badge、Progress、Prompt）和自定义组件（ArticleList、FeedHeader）
3. 通过 agent 创建新组件：
   - "Create a component called StarredArticles that only shows starred items"
   - Agent 执行 `write_component("StarredArticles", "...")`
   - 新组件立即可用于 codoc 的 MDX body

### 6.3 手动创建 codoc

1. 点击 file tree 上方的 + 按钮
2. 输入路径（如 `notes/weekly-review.codoc`）
3. 创建空模板 codoc
4. 通过 Editor 或 agent 添加内容

**验证点：**
- [ ] Editor 保存后 Preview 是否实时更新
- [ ] 自定义组件写入后是否立即可用
- [ ] 新建 codoc 是否出现在 file tree 和 DAG 中

---

## Story 7: 多 Provider 聊天

### 7.1 切换聊天 provider

1. 在 Chats tab 中，点击 "Switch provider" 按钮
2. 从可用 provider 中选择（Claude Code / Codex / Kiro 等）
3. 新对话使用选中的 provider

### 7.2 查看聊天历史

1. 切换到 Chats tab
2. 看到历史对话列表（按最近活跃排序）
3. 点击某个对话 → 恢复对话上下文
4. 可以删除不需要的对话

**验证点：**
- [ ] Provider 切换是否正常
- [ ] 聊天历史是否持久化
- [ ] 恢复对话后 agent 是否保持上下文

---

## 操作路径汇总

| 路径 | 触发方式 | 涉及的 MCP 工具 |
|------|----------|-----------------|
| 创建 workspace | UI: picker → template | — (HTTP API) |
| 浏览 feed | UI: file tree → click | — (REST API) |
| 生成 digest | Chat: "what's new" | `list_codocs`, `read_codoc`, `update_data_field` |
| 标记已读 | Chat: "mark as read" | `read_codoc`, `update_data_field` |
| 订阅新 feed | Chat: "subscribe to URL" | `write_codoc` |
| 取消订阅 | UI: delete button | — (REST API) |
| 深度调研 | Chat: "deep dive into X" | `read_codoc`, `write_codoc` |
| 调整 interval | Chat: "change interval" | `update_data_field` |
| 创建组件 | Chat: "create component" | `write_component` |
| 查看 DAG | UI: Graph button | — (REST API) |
| 编辑源码 | UI: Editor tab → save | — (REST API) |

---

## 后台机制

| 机制 | 周期 | 作用 |
|------|------|------|
| Source scheduler tick | 每 60s | 扫描所有 periodic source，检查是否到期 |
| RSS refresh | 按 interval（默认 30m） | 拉取 feed、merge 文章、更新 .source-state.json、重新编译 |
| File watcher | 实时 | 监听 .codoc 文件变化，触发 re-parse + re-resolve + re-compile |
| UI polling | 每 2-3s | 轮询 tree、codoc detail、DAG、chats 列表 |

---

## 已知的优化空间（走查时关注）

1. **首次加载体验** — 从模板创建后，首次 resolve 拉取 3 个 feed 可能需要数秒，期间 UI 状态如何？
2. **空状态引导** — inbox 为空时的 CTA 是否足够清晰？用户是否知道该打开 chat？
3. **实时反馈** — agent 通过 MCP 更新 data field 后，UI 需要等到下次 polling（2-3s）才能看到变化
4. **错误处理** — feed URL 无效时的错误路径（fetch 失败 → scheduler 打日志但不通知 UI）
5. **starred 功能** — merge 中保留了 starred 字段，但目前无 UI 和 agent workflow 来 star 文章
6. **digest 过期** — 没有机制标记旧的 digest 为过期，用户可能看到过时的 highlights
7. **跨 feed 去重** — 同一篇文章可能出现在多个 feed 中（如 HN 和某博客），无去重
8. **大量文章性能** — 长期运行后 articles 数组会不断增长（merge 保留旧文章），需要归档策略
9. **组件可发现性** — 用户如何知道 inbox 可以用什么组件？guide 只提到了 agent 操作，没有组件目录
10. **Prompt 组件体验** — `<Prompt>` 按钮点击后是否顺畅打开 chat 并发送？是否需要已有 provider？
