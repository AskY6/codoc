# RSS Workspace 交互断裂分析与分层修复方案

> 来源：端到端测试 + 产品链路分析（2026-04-24）

## 问题诊断

### 一句话总结

模板只 scaffold 了数据，没有 scaffold 交互。产品叙事是 "AI-first RSS"，但交互范式还是 "文件浏览器 + 附带 chat"。

### 五层断裂

**1. 入口断裂 — Chat 不是主角**

Chat 有 4 个入口（sidebar Chat tab、per-codoc Chat tab、右上角 Chat 按钮、Chats 历史 tab），但没有一个是用户打开 workspace 后的第一屏。用户第一眼看到的是文件树和 "Select a codoc to begin"。

**2. 语言断裂 — Chat 说的是 codoc 语言，不是 RSS 语言**

快捷操作是 "List codocs"、"Create codoc"、"Summarize"、"Suggest fields"——平台语言。RSS 用户想要的是 "Refresh feeds"、"What's new"、"Subscribe to..."、"Mark as read"。

**3. 引导断裂 — Guide 的 "Try these" 是死文本**

Guide 列了 5 个好 prompt，渲染在 Table 组件里，不可点击。要 try 需要：记住 prompt → 离开 guide → 找到 chat → 手动打字。对比 per-codoc Chat 里的 "Summarize" 按钮是可点击执行的。

**4. 上下文断裂 — Per-codoc chat vs 全局意图不匹配**

"what's new today?" 是全局意图（遍历所有 sources，汇总到 inbox），但 per-codoc Chat 绑定的是 `@inbox.mdx` 一个文件。全局 Chat 又没有 RSS 上下文。用户的意图粒度（workspace 级）和 Chat 的上下文粒度（codoc 级或无）对不上。

**5. 能力断裂 — Agent 没有被教会 RSS 编排**

即使用户成功发出 "what's new today?"，agent 也不知道应该：读 sources/*.codoc → 提取 feedUrl → fetch RSS XML → 解析 → 写回 articles → 汇总到 inbox.highlights。没有 system prompt、没有 tool 描述、没有 workflow 编排指导。

### 用户链路现状

```
用户期望：打开 → 问一句话 → 看到结果 → 继续对话

实际链路：打开 → 看到文件树 → 点 inbox → 看到空白 → 找 guide → 读文本提示
         → 记住 prompt → 找到 Chat 入口 → 手动输入 → 祈祷 agent 知道怎么做
```

---

## 现状：Template 接口只管文件

```typescript
// apps/local/src/templates/types.ts — 当前全部能力
interface Template {
  id: string
  name: string
  description: string
  components: readonly string[]
  files(): readonly TemplateFile[]  // ← 唯一的 scaffold 手段
}
```

Chat 的 SLASH_COMMANDS、quick actions 硬编码在 `ChatPanel.tsx`。system prompt 硬编码在 `providers/claude-code.ts`。agent 被 `allowedTools: ["mcp__codoc__*"]` 锁死无法访问网络。这些都和模板无关。

---

## 修复方案：分层补充

### 基础能力层（codoc platform）— 4 项

#### P1. Template 接口扩展 — 让模板能声明交互

```typescript
interface Template {
  // 现有
  id: string
  name: string
  description: string
  components: readonly string[]
  files(): readonly TemplateFile[]

  // 新增
  commands?: readonly Command[]         // 领域 slash commands → 注入 ChatPanel
  quickActions?: readonly QuickAction[] // chat 快捷操作 → 取代硬编码 chips
  agentInstructions?: string            // 注入 system prompt → 拼接到 base prompt
  welcome?: WelcomeConfig              // 首次打开体验
}

interface Command {
  name: string
  description: string
  prompt: string       // 发送到 chat 的完整或部分 prompt
}

interface QuickAction {
  label: string
  prompt: string
}
```

**改动点**：
- `ChatPanel.tsx`：SLASH_COMMANDS 从 workspace config 读取（base commands + template commands）
- `ChatPanel.tsx`：quick actions 从 workspace config 读取（如有 template 定义则替换默认）
- 需要在 workspace 加载时保存 template metadata（当前 init 后丢弃 template 引用）

#### P2. Workspace-level Agent Instructions 拼接

当前 system prompt 在 `providers/claude-code.ts` 里写死：

```
"You are operating a codoc knowledge base via MCP tools..."
```

改为：base prompt + workspace.agentInstructions 拼接。agentInstructions 来自 template 声明，持久化在 `codoc.config.json` 或 workspace metadata。

**改动点**：
- `codoc.config.json` 增加 `agentInstructions` 字段（init 时从 template 写入）
- `claude-code.ts`（及其他 provider）：读 workspace config，拼接到 system prompt

#### P3. Actionable Prompt 组件

新增一个 builtin 组件 `<Prompt>`，在 MDX 中可用：

```mdx
<Prompt label="What's new today?" />
```

渲染为可点击按钮，onClick 将 prompt 文本发送到 Chat 面板执行。

**改动点**：
- 新增 builtin component `Prompt`（加入 component catalog）
- Preview 渲染层需要将 `<Prompt>` 的 onClick 与 ChatPanel 通信（事件/回调）

#### P4. `fetch_url` MCP Tool

Agent 被 `allowedTools: ["mcp__codoc__*"]` 锁死，无法访问外部网络。RSS 需要抓 feed XML，Bookmarks 需要抓网页。

新增通用 MCP tool：

```typescript
// mcp-server.ts
server.tool("fetch_url", {
  url: z.string().url(),
  maxBytes: z.number().optional().default(100_000),
}, async ({ url, maxBytes }) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  return { content: [{ type: "text", text: text.slice(0, maxBytes) }] };
});
```

**注意**：这是平台能力，不是 RSS 能力。任何需要外部数据的模板都会用到。

---

### RSS 领域层 — 4 项（均为填入 Template 声明）

#### R1. 领域 Commands

```typescript
// apps/local/src/templates/rss.ts
commands: [
  { name: "refresh",   description: "Fetch latest articles from all feeds",
    prompt: "Refresh all my RSS feeds and tell me what's new." },
  { name: "digest",    description: "Generate today's digest in inbox",
    prompt: "Read all sources, pick highlights, and update my inbox digest." },
  { name: "subscribe", description: "Add a new RSS feed",
    prompt: "Subscribe to a new RSS feed: " },
  { name: "deepdive",  description: "Research a topic across feeds",
    prompt: "Deep dive into: " },
]
```

#### R2. 领域 Quick Actions

```typescript
quickActions: [
  { label: "What's new today?",
    prompt: "What's new across my feeds today?" },
  { label: "Refresh feeds",
    prompt: "Refresh all my RSS feeds." },
  { label: "Subscribe to...",
    prompt: "Subscribe to " },
]
```

取代默认的 "List codocs" / "Create codoc"。

#### R3. Agent Instructions

```typescript
agentInstructions: `
You are an AI RSS assistant. The workspace structure:
- sources/*.codoc: Each has data fields: title, feedUrl, whyFollow, lastFetchedAt, articles[]
- inbox.codoc: Has data fields: highlights[], trending[], lastDigestAt

Workflows:
- REFRESH: For each source, use fetch_url on its feedUrl, parse the RSS/Atom XML,
  extract articles (title, link, pubDate), update the articles[] field via
  update_data_field, and set lastFetchedAt to now.
- DIGEST: Read all sources' articles where readAt is null (unread), select the most
  interesting as highlights, write to inbox.codoc highlights[] and trending[] via
  update_data_field, set lastDigestAt to now.
- SUBSCRIBE: Create new sources/<slug>.codoc via create_from_template with fields:
  title, feedUrl, whyFollow, lastFetchedAt: null, articles: [].
  Then immediately refresh that single feed.
- DEEP DIVE: Research a topic across all feed articles, create topics/<slug>.codoc
  with a structured summary.

Rules:
- Always use update_data_field for array/field updates, not write_codoc (preserve MDX body).
- Mark articles as read by setting readAt to ISO timestamp.
- When generating a digest, include article title, source name, and a one-line summary.
- If a fetch fails, report the error but continue with other sources.
`
```

#### R4. Guide 改造 — 死文本变 Actionable Prompt

将 guide.codoc 的 "Try these" 从 `<Table>` 改为 `<Prompt>` 组件：

```mdx
This is an AI-first RSS workspace. You don't browse feeds — you ask the agent.

## Try these

<Prompt label="What's new today?" />
<Prompt label="Deep dive into AI agents" />
<Prompt label="Refresh all feeds" />
<Prompt label="Subscribe to https://example.com/feed" />
<Prompt label="Summarize the latest from Hacker News" />

## Structure
...
```

---

## 各层职责总结

| 层 | 项 | 改动性质 | 量级 |
|---|---|---|---|
| Platform | P1. Template 接口扩展 (commands/quickActions/agentInstructions) | 扩展接口 + ChatPanel 读配置 | M |
| Platform | P2. System prompt 拼接 | provider 层读 workspace config | S |
| Platform | P3. `<Prompt>` actionable 组件 | 新 builtin component + 事件桥接 | M |
| Platform | P4. `fetch_url` MCP tool | 新增一个 MCP tool | S |
| RSS | R1. 领域 commands | 填 template 声明 | S |
| RSS | R2. 领域 quick actions | 填 template 声明 | S |
| RSS | R3. Agent instructions | 填 template 声明 | S |
| RSS | R4. Guide 改造 | 改模板文件内容 | S |

平台层 4 项完成后，RSS 层 4 项全部是**填声明 + 改模板内容**，不需要改 UI 代码。

---

## 附：端到端测试发现的其他 Bug

### Bug #1: meta 解析失效 — P0

API 返回所有 codoc 的 `meta: { title: null, description: null, tags: [] }`，但 YAML frontmatter 中有值。影响文件树显示、搜索过滤、codoc 列表。

```bash
# 复现
curl -s http://localhost:4321/api/codocs | python3 -m json.tool
# 所有 title 均为 null
```

### Bug #2: New Codoc 使用 window.prompt() — P1

`apps/local/ui/src/App.tsx:520` 用 `window.prompt()` 获取文件名，与 Delete 的自定义 Dialog 体验不一致，且阻塞自动化测试。应改为内联 Dialog。

### Bug #3: 搜索框清空后文件列表可能不恢复 — P2

需验证是否为真实用户可复现（可能仅为 agent-browser fill 的问题）。
