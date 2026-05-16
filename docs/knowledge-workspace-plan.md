# Knowledge Workspace 种子场景计划

## 背景

当前“个人知识库管理”如果只从 template 开始，容易落成一个能初始化目录、能放几篇样例 codoc 的脚手架，但这不构成一个完整场景。

对这个仓库来说，**种子场景必须是一个完整 vertical**，而不是一组看起来合理的示例文件。

这意味着：

1. 用户进入 workspace 后就能知道接下来做什么。
2. 核心循环不依赖用户理解文件树结构。
3. 关键读模型不是手写维护，而是系统稳定产出。
4. AI 是增强层，不是唯一入口。

这份文档先定义场景边界和实施顺序，后续实现必须以此为准，而不是边写边发明产品。

## 与 language workspace 的关系

Knowledge 和 language 是两个独立的 `workspaceKind`，结构同构（encounter → capture → 系统告诉你 next action → 反囤积），但语义上不同——详细对照见 `docs/language-workspace-plan.md` 中"与 knowledge workspace 的关系"一节。

明确不做的事：

1. 把 word / vocabulary 当作 knowledge workspace 的第四种对象（会污染 book / blog / evergreen note 这条主线，掉进泛 PKM 陷阱）
2. 抽象 knowledge 和 language 的公共基类 / generic spaced-cognition workspace——目前只有两例，premature abstraction 会损害两个 vertical 各自的清晰度，三例之前不抽象

两者唯一的接触面是 codoc 层稳定 ref——v1 阶段使用 `CodocPath`，`CodocId` 不引入 local runtime。blog / book / note codoc 可以被 language workspace 通过 `CodocPath` 引用，但 knowledge 这一侧不需要为此做任何额外工作。详见末节"跨 workspace 接口"。

## 宿主侧依赖（已落地）

本 plan 的字段、API、agent contract 基于以下 4 项宿主能力，目前均已在 host 中实现：

1. `WorkspaceUiSpec.homeCodocPath` 字段 + App.tsx auto-focus 泛化（dashboard 首屏前提）
2. `apps/local/ui/src/plugin-views/` 目录 + plugin view registry（Queue / Notes / Review 三个 view 的渲染前提）
3. 全局 ref 模型为 `CodocPath`，`CodocId` 不引入 v1
4. `plugin.getAgentInstructions()` 已接通到 provider，specialist 注册不在 v1 范围

后续 plugin 框架演化方向见 `docs/plugin-architecture-v2.md`。

## 场景定义

Knowledge workspace 的起点不是“管理所有个人知识”，而是一个更窄、更强的切口：

> **围绕 reading 的知识生产工作流：book / blog 作为输入，evergreen note 作为输出。**

第一版只覆盖三个对象：

1. `book`
2. `blog`
3. `evergreen note`

不在第一版解决的对象：

1. podcast
2. video
3. meeting notes
4. todos / project planning
5. 全量双向链接系统

原因很直接：如果第一版同时吞太多对象，场景会变成“泛笔记应用”，失去 seed scenario 应有的清晰主路径。

## 产品目标

第一版的目标不是“知识管理功能很多”，而是下面这条主路径闭环成立：

1. 把一本书或一篇 blog 放进系统。
2. 系统能明确告诉用户哪些内容正在读、哪些内容卡住了、下一步是什么。
3. 用户能把多个来源蒸馏成一篇 evergreen note。
4. 用户能在之后回到 workspace 时，快速找回当前 focus、阅读队列、主题分布和待清理问题。

成功标准：

1. 用户第一次进入 workspace，默认看到的是 `dashboard`，不是通用文件树。
2. 用户不需要先理解 `library/books`、`library/blogs`、`notes/evergreen` 的目录结构，才能开始使用。
3. dashboard 不是手工维护页面，而是由 plugin 从源 codoc 同步出来的稳定读模型。
4. “下一步读什么”“哪些条目缺 next action”“哪些 note 没有来源”这类问题可以直接回答。

## 非目标

第一版明确不做：

1. 通用 PKM 平台
2. 多 workspace kind 复用同一套复杂知识图谱
3. 自动全文抓取所有来源类型
4. 丰富编辑器、复杂 block 结构、双向链接浏览器
5. 依赖 LLM 才能完成的核心读路径

这不是因为这些不重要，而是因为种子场景首先要证明一个完整 vertical 在这个架构里能成立。

## 领域模型

### Book

Book 是“长周期来源”，重点不是收藏，而是推进阅读进度并沉淀观点。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `title` | 书名 |
| `author` | 作者 |
| `status` | `queued \| reading \| finished` |
| `progress` | `{ current, target, unit }` |
| `whyRead` | 为什么要读 |
| `summary` | 当前摘要 |
| `keyIdeas` | 关键观点 |
| `openQuestions` | 阅读中产生的问题 |
| `nextAction` | 下一步 |
| `tags` | 主题标签 |
| `addedAt` | ISO timestamp，加入 queue 的时间；`readingQueue` / `currentFocus` 的 `queued` 段按此升序 |
| `lastUpdatedAt` | ISO timestamp，最近一次条目内容更新；`readingQueue` / `currentFocus` 的 `reading` 段按此降序 |

### Blog

Blog 是“短周期来源”，重点是捕获、提炼、决定是否进入长期知识层。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `title` | 标题 |
| `url` | 原文链接 |
| `author` | 作者 |
| `status` | `captured \| distilled` |
| `publishedAt` | 发布时间 |
| `readingTimeMin` | 阅读时间 |
| `whySave` | 为什么值得保留 |
| `summary` | 摘要 |
| `keyIdeas` | 关键观点 |
| `quotes` | 摘录 |
| `nextAction` | 下一步 |
| `tags` | 主题标签 |
| `addedAt` | ISO timestamp，加入 captured 列表的时间；`readingQueue` 的 `captured` 段在长度并列时按此升序 tie-break |
| `lastUpdatedAt` | ISO timestamp，最近一次摘录 / 摘要更新；`currentFocus` 候选筛选与 `review` 读模型可参考 |

### Evergreen Note

Evergreen note 是输出层，不是来源备份。它必须表达一个可复用主张。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `title` | 标题 |
| `stage` | `evergreen` 或其他明确阶段 |
| `thesis` | 核心论点 |
| `claims` | 支撑论点的短列表 |
| `relatedSources` | `CodocPath[]`，来源 codoc 引用列表 |
| `nextStep` | 下一步连接或扩展 |
| `tags` | 主题标签 |

## 产品读模型

源数据不是直接暴露给用户的最终形态。Knowledge workspace 需要一个由 plugin 维护的读模型层。

第一版至少需要这 5 个读模型：

1. `library`
   作用：统一列出 books / blogs / notes 的核心状态
2. `currentFocus`
   作用：告诉用户现在最值得推进的**单一**条目（dashboard 主位置）。确定性规则，按优先级第一个命中：
   - book 中 `status === 'reading'` 的最新更新者（按 `lastUpdatedAt` 降序）
   - blog 中 `status === 'captured'` 且未被任何 evergreen note 的 `relatedSources` 引用过、`readingTimeMin` ≤ 15 的最旧 `publishedAt`
   - book 中 `status === 'queued'` 的最旧 `addedAt`
   - 都没命中 → 返回 null（dashboard 显示空状态提示用户加来源）
3. `readingQueue`
   作用：按优先级给出下一批应该处理的来源。确定性排序，**concat** 三段，组内排序：
   - 段 1：`status === 'reading'` 的所有 books，按 `lastUpdatedAt` 降序
   - 段 2：`status === 'captured'` 的所有 blogs，按 `readingTimeMin` 升序（短的先做，鼓励高频蒸馏）
   - 段 3：`status === 'queued'` 的所有 books，按 `addedAt` 升序（先到先做）
   - finished / distilled 永不进入此 queue
4. `topicMap`
   作用：按 tags 汇总主题覆盖，不做知识图谱，只做轻量主题分布
5. `review`
   作用：找出结构性问题，例如缺 next action、无标签、orphan note

这些读模型的展示载体是 `dashboard.codoc`，但**事实源不在 dashboard**，而在：

1. `library/books/*.codoc`
2. `library/blogs/*.codoc`
3. `notes/evergreen/*.codoc`

dashboard 只是投影视图。

## 为什么不能只做 template

如果只有 template，会立刻出现 4 个问题：

1. `dashboard` 会变成手写样例，一旦用户开始编辑，系统没有稳定同步语义。
2. “What should I read next?” 只能靠 agent 临时读文件推断，无法形成可预测的产品状态。
3. UI 没有专用 view，用户会被带回通用 tree-first 交互。
4. review 能力无法成立，因为没有统一读模型来判断什么是“卡住了”。

因此第一版必须是 plugin，不是单纯模板。

## 插件边界

Knowledge workspace 应作为一个一等 `workspaceKind` 落地，例如 `knowledge`。

建议边界如下：

### Plugin 拥有

1. `knowledgeTemplate`
2. `KnowledgePluginConfig`
3. 读模型构建逻辑
4. `dashboard` 自动同步 job
5. domain API
6. workspace UI spec
7. knowledge-specific agent instructions

### Plugin 不拥有

1. codoc CRUD 平台能力
2. parser 通用能力
3. source scheduler 通用能力
4. MCP transport
5. 通用聊天 provider

## UI 方案

第一版不做复杂新壳子，但要把 workspace 表现成 dashboard-first。

### 主页

默认打开 `dashboard.codoc`。

### Action Bar

至少提供：

1. `Sync dashboard`
2. `Review now`
3. `Add book`
4. `Capture blog`

其中：

1. `Sync dashboard` 和 `Review now` 是真实 REST 动作
2. `Add book` 和 `Capture blog` 可以先走 chat prompt

### Secondary Views

至少提供 3 个：

1. `Queue`
   展示当前最该处理的来源
2. `Notes`
   展示 evergreen notes 及其来源覆盖
3. `Review`
   展示结构性问题列表

这些 view 不直接读 codoc 文件，而是只消费 plugin API 返回的读模型。

## API 方案

建议第一版 API 面如下：

| Method | Path | 作用 |
| --- | --- | --- |
| `GET` | `/api/plugins/knowledge/overview` | 完整读模型 |
| `GET` | `/api/plugins/knowledge/queue` | 只取阅读队列 |
| `GET` | `/api/plugins/knowledge/notes` | 只取 evergreen notes 视图 |
| `GET` | `/api/plugins/knowledge/review` | 只取 review 视图 |
| `POST` | `/api/plugins/knowledge/sync` | 强制同步 dashboard |
| `POST` | `/api/plugins/knowledge/review` | 用上一节的确定性规则重算 currentFocus / readingQueue / review，写回 dashboard 并更新 `lastReviewAt` |

设计原则：

1. API 返回稳定读模型，不让前端自己拼状态。
2. `sync` 是幂等的。
3. `review` 不是独立存储，而是一次读模型计算 + dashboard 更新时间戳。

## 自动同步策略

dashboard 必须自动维护，否则场景会退化回“你自己去编辑看板”。

建议第一版策略：

1. workspace 打开时，如果 `dashboard` 过旧或未同步过，执行一次 catch-up sync
2. `books / blogs / notes` 下的 codoc 被更新后，debounce 一次 dashboard sync
3. 再加一个低频周期 sync 作为兜底

注意：

1. `dashboard.codoc` 自己变化不应反触发递归同步
2. `guide.codoc` 不参与同步

## Agent contract

这个场景的 agent 不能只是一句泛 prompt。它必须明确源数据和投影视图的边界。

至少要支持 5 类动作：

1. `ADD BOOK`
   从用户输入创建一本书的 codoc
2. `CAPTURE BLOG`
   抓取页面，生成 blog codoc
3. `DISTILL NOTE`
   从多个来源生成 evergreen note
4. `UPDATE SOURCE`
   更新状态、进度、next action、related sources
5. `REVIEW BACKLOG`
   基于现有来源回答“现在该看什么”

关键规则：

1. 源 codoc 是事实源
2. `dashboard` 是 plugin 同步出的读模型
3. 不鼓励 agent 手工改写 dashboard 作为主要路径

v1 实现路径：

1. `getAgentInstructions()` 贡献 system prompt 段，让 base / general agent 理解 5 类动作的语义和边界
2. `registerMcpTools()` 暴露 `addBook` / `captureBlog` / `distillNote` / `updateSource` / `reviewBacklog` 工具
3. v1 **不**注册 specialist agent；service 层 router + specialist 图当前硬编码，没有 plugin-registered specialist 机制，留到独立未来 task

## 种子内容要求

为了让这个场景一开始就“完整”，种子内容不能只是占位符。

建议最小种子集：

1. 2 本书
2. 2 篇 blog
3. 1 篇 evergreen note

要求：

1. 覆盖不同状态，而不是全部 `queued`
2. 至少有一个条目缺 `nextAction`，用来验证 review
3. 至少有一个 note 带 `relatedSources`
4. 至少覆盖 2 到 3 个共享 tags，用来验证 topic map

种子内容的作用不是展示文案，而是验证读模型和 review 逻辑。

## 跨 workspace 接口

第一版**不主动与任何其他 workspace 联动**。所有跨 workspace 场景（被 language workspace 引用 blog 作为生词出处、被未来其他 workspace 引用 evergreen note 等）均不属于 knowledge 自己的 v1 范围。

但 knowledge workspace 产出的 codoc（`book` / `blog` / `evergreen note`）天然就是可被外部引用的——`CodocPath` 在 local runtime 已是稳定 ref，不需要 knowledge plugin 做任何额外工作来"暴露"自己。

具体含义：

1. 其他 workspace（例如 language）可以在自己的字段里持有 `CodocPath[]` 引用，指向 knowledge workspace 里的 blog / book / note codoc——这条路 v1 已经是通的
2. 跨 workspace 引用的**主动方在调用侧**（例如 language 的 `addWord` tool 接收 `sourceCodocPath` 参数），knowledge 这一侧只需保持 codoc 路径稳定即可，**不需要暴露任何 "供其他 workspace 调用" 的 API**
3. knowledge workspace 的 UI 渲染、读模型计算、agent 都不感知"自己被其他 workspace 引用"——保持单 workspace 视野是 big-block 联动原则的核心

明确**不预留**的内容：

1. 任何形式的 inbound webhook / 跨 workspace lookup API
2. blog renderer 内的跨 workspace 组件注入（例如 `<KnownWord>` 这种被语言学习侧改写文章渲染的设计）
3. knowledge agent 跨 workspace 读其他 workspace 的能力

这些都不在 v1 范围内，需要时再加。

## 实施顺序

宿主侧 4 项依赖（见上文"宿主侧依赖"）已落地，本 plan 从 Phase 1 起步。

### Phase 1: 领域收口

先确认：

1. 三类对象字段（含 `relatedSources: CodocPath[]`）
2. 状态语义
3. dashboard 读模型 shape，含 `currentFocus` / `readingQueue` 的确定性排序规则
4. review 规则

产出：

1. 本文档
2. 对应的 TS 类型草案

### Phase 2: Plugin 后端

实现：

1. `plugins/knowledge/`
2. config / detect / template 绑定
3. service 读模型计算
4. API routes
5. sync job

产出：

1. `knowledge` 成为一等 `workspaceKind`
2. `dashboard` 可自动同步

### Phase 3: 前端专用视图

实现：

1. `home` 进入 `dashboard`
2. Queue / Notes / Review 三个 plugin view
3. action bar 接线

产出：

1. 不再是 generic tree-first 体验

### Phase 4: Agent contract

实现：

1. `getAgentInstructions()` 返回 knowledge-specific 段（依赖 Phase 0 已接通 plugin hook）
2. `registerMcpTools()` 暴露 5 类动作工具，input schema 使用 `CodocPath`
3. 不注册 specialist；通过 base / general agent + 工具组合表达 5 类动作

产出：

1. AI 作为增强层而不是唯一入口

### Phase 5: 验证

验证项：

1. `init --from knowledge`
2. 默认进入 `dashboard`
3. 改动来源后 dashboard 自动更新
4. Queue / Notes / Review 能给出稳定结果
5. `typecheck / build / init / compile` 全通过

## 验收标准

只有当下面这些都成立，才算“完整开始”：

1. Knowledge workspace 不是 template demo，而是 plugin-backed vertical
2. 用户有清晰主路径，不需要先理解目录结构
3. dashboard 是自动维护的读模型，不是手写页面
4. review 机制能暴露结构性问题
5. 核心循环即使没有 AI 也能走通基本路径

## 当前结论

下一步不应继续先写模板或先做几个示例 codoc，而应先进入 **Phase 1: 领域收口**，把：

1. 对象字段
2. 状态语义
3. dashboard shape
4. review 规则

先定死，再开始实现。
