# RSS Workspace v2 — 从"能跑通"到"能日用"

> 前置：`rss-interaction-gap.md` 中的 P1-P4 / R1-R4 已全部落地。
> 本文档基于落地后的端到端测试复盘，识别结构性 gap 并提出 v2 方案。

---

## 0. 一句话判断

v1 证明了管道能跑通（template → config → agent instructions → fetch_url → MCP）。
但 **AI 在做错误的工作**：90% 的 token 花在 fetch/parse/store，
而用户真正需要 AI 做的事（优先级排序、摘要、综合分析）一件都没做。

---

## 1. 日常使用链路审计

以"每天跟进技术动态的工程师"为用户画像，审计高频动作：

| 动作 | 频率 | v1 体验 | 问题 |
|------|------|---------|------|
| 看今天有什么新的 | 每天 | `/refresh` → 等 30-60s agent 跑 20+ 轮工具调用 | 传统 RSS reader 打开即有，这里是**倒退** |
| 扫标题、分拣 | 每天 | inbox 里 `<Table>` 展示 highlights | 无已读/未读区分、无点击展开、无键盘快捷键 |
| 读一篇文章 | 每天 3-5 次 | **无法做到** | 没有阅读视图、没有 reader mode、被迫开浏览器 |
| 搜某篇文章 | 每天 1-2 次 | `search_codocs` 只搜元数据 | 搜不到文章内容 |
| 周末补课 | 每周 | 等同 refresh，但范围是一周 | 同上，更慢 |
| 加新 feed | 每周 | `/subscribe` | OK |

**结论**：6 个高频动作里只有 1 个体验是合格的。

---

## 2. 根因：AI 在做机械活

```
当前架构：
用户手动触发 → LLM fetch XML → LLM parse XML → LLM update_data_field → 用户自己看
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                这些是基础设施的活，不是 LLM 的活
```

LLM 每次 refresh 要：
1. `list_codocs`（1 轮）
2. `read_codoc` × N 个 source（N 轮）
3. `fetch_url` × N 个 feed（N 轮）
4. 在上下文里 parse RSS/Atom XML（消耗大量 token）
5. `update_data_field` × N 个 source（N 轮）
6. 汇总到 inbox（2-3 轮）

3 个 feed 就要 15-20 轮，10 个 feed 就会打爆 `maxTurns`。
而且每次都要重新做，没有缓存、没有增量。

**AI 真正该做的事**（当前一件没做）：

| 能力 | 描述 | 为什么只有 AI 能做 |
|------|------|-------------------|
| 优先级排序 | 30 条标题挑 5 条最值得看的 | 需要理解用户兴趣 |
| 摘要生成 | 没时间读的文章，3 句话概括 | 需要理解文章内容 |
| 跨 feed 综合 | "这周三个 feed 都在讨论 MCP" | 需要跨文档推理 |
| 主动提醒 | "Simon Willison 写了和你上周关注话题相关的文章" | 需要记忆 + 关联 |
| 问答 | "最近大家怎么看 Claude Code？" | 需要多篇文章综合回答 |

---

## 3. 设计原则

1. **基础设施做基础设施的事**：fetch / parse / store / 增量 / 去重 → 代码实现，无 LLM
2. **AI 做只有 AI 能做的事**：排序 / 摘要 / 综合 / 问答 → LLM
3. **高频动作零等待**：打开就有内容，不需要手动触发 refresh
4. **分拣是核心瓶颈**：RSS 的价值在"少量值得读"vs"大量噪音"，UI 必须为分拣优化

---

## 4. 架构：基础设施 / 智能 分离

### 4.1 RSS Source Provider（基础设施层）

codoc 的数据模型已有 `$source` 机制。RSS 拉取应该成为一个 source provider，
不经过 LLM：

```yaml
# sources/hacker-news.codoc — data 层
data:
  feedUrl: "https://hnrss.org/frontpage"
  articles:
    $source: rss               # ← source provider，不是 LLM
    url: $ref(#data.feedUrl)
    interval: 30m              # 拉取间隔
```

Source provider 实现：

```typescript
// source-providers/rss.ts
interface RssSourceProvider extends SourceProvider {
  kind: "rss";

  /** 纯函数：URL → Article[]，无副作用 */
  fetch(params: { url: string }): Promise<Article[]>;
}

interface Article {
  id: string;          // guid or link hash
  title: string;
  link: string;
  pubDate: string;     // ISO 8601
  summary?: string;    // RSS description field
  content?: string;    // content:encoded if available
  source: string;      // feed title
}
```

**关键决策**：
- provider 是纯函数，不碰 workspace state
- 去重由 workspace resolve 层处理（按 article.id）
- 增量：只追加新文章，不覆盖已有（保留 readAt 等用户状态）
- 定时触发由 server 的 watcher/scheduler 负责，不需要用户手动 `/refresh`

### 4.2 后台刷新调度

```
Server 启动
  └→ 对每个 $source: rss 的 data field
      └→ 启动定时任务（interval 默认 30m）
          └→ fetch → parse → merge（增量去重）→ resolveAll
              └→ 如果有新文章 → 触发 "new-articles" 事件
```

`new-articles` 事件可以被多个消费者监听：
- UI 推送通知（"3 条新文章"）
- 自动触发 AI digest（可配置）

### 4.3 AI 层：Digest / Summarize / Q&A

AI 不再参与 fetch/parse/store。它只在以下场景被调用：

**场景 A：生成 Digest**
```
触发条件：用户主动 /digest，或 new-articles 事件 + 自动 digest 配置开启
输入：所有未读文章的 title + summary（不需要全文，控制 token）
输出：inbox.codoc 的 highlights[] 和 trending[] — 包含排序理由
```

**场景 B：文章摘要**
```
触发条件：用户点击"摘要"按钮
输入：单篇文章的 content（fetch_url 获取全文 或 RSS content:encoded）
输出：3-5 句摘要，直接显示在阅读面板
```

**场景 C：跨 feed 问答**
```
触发条件：用户在 chat 中自由提问
输入：用户问题 + 相关文章（通过语义搜索或关键词匹配检索）
输出：综合回答，附引用来源
```

---

## 5. UI 组件设计

### 5.1 `<FeedInbox>` — 替代 inbox 中的 `<Table>`

分拣优化的文章列表：

```
┌─────────────────────────────────────────────┐
│ ● Simon Willison                    2h ago  │
│   MCP Servers Are Eating the World          │
│   A practical look at how model context...  │
│                                    📖 💬 ⊕  │
├─────────────────────────────────────────────┤
│ ○ Hacker News                       5h ago  │
│   Show HN: SQLite on the Edge              │
│   Running SQLite in Cloudflare Workers...   │
│                                    📖 💬 ⊕  │
└─────────────────────────────────────────────┘

● = 未读   ○ = 已读
📖 = 读全文   💬 = 问 AI   ⊕ = 收藏/深入
```

**交互**：
- 点击卡片 → 展开摘要（如果有）+ 阅读按钮
- `📖` → 打开 ArticleReader 面板
- `💬` → 打开 chat 并预填 "Summarize this article: [title]"
- 键盘：`j/k` 导航，`o` 展开，`m` 标记已读

### 5.2 `<ArticleReader>` — 阅读面板

在中央面板打开，替代 DocumentPanel 的位置：

```
┌─ MCP Servers Are Eating the World ──────────────┐
│ Simon Willison · 2h ago · simonwillison.net      │
│                                                  │
│ ┌──── AI Summary ─────────────────────────────┐  │
│ │ 1. MCP servers are becoming the standard... │  │
│ │ 2. Key players include...                   │  │
│ │ 3. The implication for developers is...     │  │
│ └─────────────────────────────────────────────┘  │
│                                                  │
│ [Full article content in reader mode]            │
│ ...                                              │
│                                                  │
│              [Open original ↗] [Ask AI 💬]       │
└──────────────────────────────────────────────────┘
```

**内容获取**：
- 优先使用 RSS `content:encoded`（很多 feed 包含全文）
- 不足则 `fetch_url` 获取原文 → 用简单 HTML→Markdown 清洗
- AI Summary 按需生成（不是每篇都生成，用户点击时才调用）

### 5.3 状态管理：已读/收藏

在 article 数据上增加用户状态字段：

```typescript
interface Article {
  // ... 现有字段
  readAt?: string;       // 标记已读的时间戳
  starred?: boolean;     // 收藏
}
```

这些字段由 UI 直接通过 `update_data_field` 修改，不经过 LLM。
前端可以调 REST API 而不是走 chat。

---

## 6. 数据流总览

```
                     ┌──────────────────────┐
                     │   RSS Source Provider │  基础设施层
                     │  (fetch + parse XML) │  无 LLM
                     └──────┬───────────────┘
                            │ Article[]
                            ▼
                     ┌──────────────────────┐
                     │   Workspace Resolve   │  增量合并、去重
                     │  (merge + dedup)      │
                     └──────┬───────────────┘
                            │ new-articles event
               ┌────────────┼────────────────┐
               ▼            ▼                ▼
        ┌────────────┐ ┌──────────┐   ┌────────────┐
        │ UI 通知     │ │ AI Digest│   │ 其他消费者  │
        │ "3 条新文章"│ │ (可选)   │   │ (webhook?) │
        └────────────┘ └──────────┘   └────────────┘
                            │
                            ▼
                     ┌──────────────────────┐
                     │   inbox.codoc         │  highlights / trending
                     │   (AI 生成)           │
                     └──────────────────────┘
```

---

## 7. 与 v1 的关系

v1 的产出**全部保留**，v2 是在其上的增量演进：

| v1 产出 | v2 中的角色 |
|---------|-----------|
| Template commands / quickActions / agentInstructions | 保留，仍用于 chat 交互 |
| `<Prompt>` 组件 + event bus | 保留，guide 中的按钮仍然有用 |
| `fetch_url` MCP tool | AI digest / Q&A 场景仍需要（按需读全文） |
| Config 持久化机制 | 扩展：增加 `refreshInterval`、`autoDigest` 等配置 |

**v2 新增**：

| 项 | 层 | 量级 |
|----|----|----|
| RSS source provider | 基础设施 | L — 新的 source provider 抽象 |
| 后台刷新调度 | 基础设施 | M — server scheduler |
| `<FeedInbox>` 组件 | UI | L — 新组件，需要分拣交互设计 |
| `<ArticleReader>` 面板 | UI | M — 阅读视图 + HTML 清洗 |
| 已读/收藏 REST API | API | S — 直接调 update_data_field |
| AI digest 重构 | AI | M — 输入从"agent 自己 fetch"变为"从已有数据读" |
| 文章语义搜索 | AI | M — 支持 Q&A 场景 |

---

## 8. 分阶段路线

### Phase 1 — 打开即有内容（消灭手动 refresh）

1. 实现 RSS source provider（fetch + parse + 增量合并）
2. Server 启动时注册定时刷新任务
3. 前端感知数据变化（watcher 已有，WebSocket push 或轮询）

**验收**：打开 workspace → 文章已经在那了，不需要问 agent

### Phase 2 — 分拣能用（消灭 `<Table>` inbox）

1. `<FeedInbox>` 组件：卡片列表 + 未读标记 + 展开摘要
2. 已读/收藏通过 REST API 直接写（不经过 chat）
3. 键盘快捷键

**验收**：能在 30 秒内扫完 30 条标题，标记 3 条想读的

### Phase 3 — 能读文章（消灭"打开浏览器"）

1. `<ArticleReader>` 面板
2. 全文获取（content:encoded 优先，fallback fetch_url + 清洗）
3. AI 按需摘要

**验收**：从标题到读完不离开 codoc

### Phase 4 — AI 做对的事

1. AI digest 重构：输入是已存储的文章数据，不再自己 fetch
2. 跨 feed 综合分析
3. 用户兴趣学习 + 优先级排序

**验收**：AI digest 的内容质量明显优于简单的时间排序

---

## 9. 决策记录

1. **Source provider 的通用性** — **先不抽象，只做 RSS。**
   Bookmarks 等场景等到真正需要时再考虑复用。避免过早泛化。

2. **文章存储粒度** — **按需升格。**
   文章留在 source codoc 的 `articles[]` 数组里。
   当用户对某篇感兴趣（要求 summary / deep dive）时，AI 才将其写成独立 codoc。
   数组是索引，codoc 是展开。

3. **AI digest 触发时机** — **三者都要，per-feed 可配。**
   - 手动：`/digest`
   - 自动：new-articles 事件触发（可配延迟）
   - 定时：cron 表达式（如 `0 8 * * *`）
   - 不同 feed 可以有不同策略（高频 feed 自动 digest，低频 feed 只通知不 digest）
   - 配置粒度在 source codoc 的 data 层，如 `digestPolicy: "auto" | "manual" | "scheduled"`

4. **全文获取的伦理边界** — **尊重 robots.txt 和 paywall。**
   `fetch_url` 行为与 RSS reader 行业惯例一致，但应检查 robots.txt、不绕过 paywall、不缓存付费内容。
