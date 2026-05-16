# Language Workspace 种子场景计划

## 背景

继 knowledge workspace 之后，把"英语单词学习"作为第二个一等 `workspaceKind` 落地，命名为 `language`。

这件事的目的不是再开一个泛知识工具，而是验证两件事：

1. 我们的 plugin platform（template + 读模型 + dashboard + sync + agent contract）在与 knowledge 不同的 domain 上仍然贴合，这是抽象正确的强证据。
2. 把英语学习这个有清晰主路径的场景做成完整 vertical，而不是堆叠成 knowledge 的子能力。

这份文档先定义场景边界和实施顺序，后续实现必须以此为准，而不是边写边发明产品。

## 与 knowledge workspace 的关系

Knowledge 和 language 结构上同构（encounter → capture → 系统告诉你 next action → 反囤积），但语义上不同：

| 维度 | Knowledge | Language |
| --- | --- | --- |
| 来源单位 | book / blog（重） | word（轻） |
| 输出形态 | artifact（evergreen note codoc） | internalization（mastered 状态，无 artifact） |
| 内化机制 | cross-source synthesis | spaced retrieval |
| 失败模式 | 囤积了一堆未蒸馏的来源 | 囤积了一堆未掌握的词 |

两者**不应合并为同一 workspace**——合并会重新掉进 v1 文档警告过的"泛 PKM 陷阱"。两者也**不抽象出公共基类**——目前只有两个 vertical，三例之前不抽象，强行做 generic spaced-cognition base 会损害各自的清晰度。

跨 workspace 联动只通过 codoc 层稳定 ref 实现（big-block，user-initiated），不在 v1 范围内，详见末节"跨 workspace 接口"。

## 宿主侧依赖（已落地）

本 plan 的字段、API、agent contract 基于以下 4 项宿主能力，目前均已在 host 中实现：

1. `WorkspaceUiSpec.homeCodocPath` 字段 + App.tsx auto-focus 泛化（dashboard 首屏前提）
2. `apps/local/ui/src/plugin-views/` 目录 + plugin view registry（Queue / Library / Review 三个 view 的渲染前提）
3. 全局 ref 模型为 `CodocPath`，`CodocId` 不引入 v1
4. `plugin.getAgentInstructions()` 已接通到 provider，specialist 注册不在 v1 范围

后续 plugin 框架演化方向见 `docs/plugin-architecture-v2.md`。

## 场景定义

Language workspace 的起点不是"管理所有英语学习"，而是一个更窄、更强的切口：

> **围绕 vocabulary acquisition 的学习工作流：在真实文本中捕获生词 → 反复 review → 内化为 mastered。**

第一版只覆盖一个对象：

1. `word`

不在第一版解决的对象：

1. `theme` / `wordlist`（v1 用 `tags` 表达，不做独立对象）
2. `writingSample`（产出层，未来再加）
3. `grammarPoint` / `phrase` / `idiom`
4. 听力 / 口语 / 阅读理解任何非 vocabulary 单元

原因和 knowledge 一致：v1 同时吞太多对象会变成"泛语言学习应用"，失去 seed scenario 应有的清晰主路径。

## 产品目标

第一版的目标不是"学习功能很多"，而是下面这条主路径闭环成立：

1. 用户把一个生词放进系统（手输 / 粘贴一段英文选词 / 未来从其他 workspace 收藏）。
2. 系统能明确告诉用户今天该复习哪些词、哪些词卡住了、最近捕获了什么。
3. 用户能在每次 review 中把一个词推进到 `mastered`。
4. 用户能回到 workspace 时，快速找回当前 review queue、主题分布、停滞词。

成功标准：

1. 用户第一次进入 workspace，默认看到的是 `dashboard`，不是通用文件树。
2. 用户不需要先理解 `words/` 的目录结构，才能开始学习。
3. dashboard 不是手工维护页面，而是由 plugin 从源 word codoc 同步出来的稳定读模型。
4. "今天该复习什么""哪些词卡住了""最近加了什么"这类问题可以直接回答。
5. 没有 LLM 也能完成核心 review 循环。

## 非目标

第一版明确不做：

1. SRS 算法（SM-2 / 难度系数 / 遗忘曲线）——只做"按 lastReviewedAt 排序 + 阈值过滤"的朴素 review
2. 词形还原 / lemmatization（runs/ran/running → run）
3. spelling 反查索引（lookup by surface form across the workspace）
4. Anki 替代品（卡片 UI / 翻卡动效 / 难易度按钮）
5. 听写 / 听力 / 发音 / 口语 / 阅读理解
6. 产出层（用学过的词写作）
7. 跨 workspace 联动（仅保留数据契约，不实现 UI / agent 路径）
8. 依赖 LLM 才能完成的核心 review 路径

这不是因为这些不重要，而是因为种子场景首先要证明完整 vertical 在这个架构里能成立。

## 领域模型

### Word

Word 是 language workspace 唯一的源对象，重点不是收藏，而是推进掌握度。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `spelling` | 词形，**归一化存储**（lowercase + trim），未来需要做查找索引时无需迁移数据 |
| `partOfSpeech` | 词性（`noun` / `verb` / `adj` / `adv` / ...，多义词可多值） |
| `definition` | 释义（中英文皆可，鼓励简短） |
| `exampleContext` | 真实出现的例句或语境片段 |
| `sourceRefs` | `CodocPath[]`，词曾出现过的源 codoc 引用，v1 多数为空 |
| `status` | `new \| learning \| mastered` |
| `lastReviewedAt` | 上次复习时间（ISO 字符串），用于 review queue 排序 |
| `addedAt` | 加入时间 |
| `tags` | 主题标签（v1 替代独立 `theme` 对象） |
| `notes` | 私人备注（可选，自由文本） |

状态语义与转移：

- `new`：刚加入，从未 review 过；**在 review queue 的 First review 段里，是主路径的首日入口**
- `learning`：完成首次 review 后自动从 `new` 进入；之后按 spaced review 规则反复出现在 queue
- `mastered`：用户主动标记掌握；不进入 review queue，除非用户主动回退

状态转移：

- `new --[首次 review]--> learning`（自动）
- `learning --[标 still learning]--> learning`（更新 `lastReviewedAt`）
- `learning --[标 mastered]--> mastered`（手动）
- `mastered --[手动回退]--> learning`（少见）

字段不放在 v1 里：`difficulty`、`easinessFactor`、`interval`、`pronunciation`、`etymology`、`synonyms[]`、`antonyms[]`、`derivations[]`——这些都属于"做更深 vocab 工具"才需要的字段，v1 不引入。

## 产品读模型

源数据不是直接暴露给用户的最终形态。Language workspace 需要一个由 plugin 维护的读模型层。

第一版至少需要这 4 个读模型：

1. `library`
   作用：统一列出所有 word 的核心状态
2. `reviewQueue`
   作用：今天该复习的词。两段组合，确定性可推断：
   - **First review 段**：`status === 'new'` 的全部，按 `addedAt` 升序——新加的词必须当天首次过一遍，过一次后 status 推进到 `learning`
   - **Spaced review 段**：`status === 'learning'` 且 `lastReviewedAt` 距今 ≥ N 天（N 可配置，默认 1），按 `lastReviewedAt` 升序
   - First review 段排在 Spaced review 段之前，保证新词不会因为"全是旧词要复习"被淹没
   - `status === 'mastered'` 永不进入此 queue，除非用户回退状态
3. `recentlyAdded`
   作用：最近 7 天加入的词
4. `stuck`
   作用：status=`learning` 超过 X 天（默认 14）且 lastReviewedAt 很久没动的词，提示用户换方式记忆
5. `topicMap`
   作用：按 `tags` 汇总主题分布，不做知识图谱

这些读模型的展示载体是 `dashboard.codoc`，但**事实源不在 dashboard**，而在：

1. `words/*.codoc`

dashboard 只是投影视图。

## Dashboard

Dashboard 默认包含 5 块：

1. **Today's review** — `reviewQueue` 前若干条，含一键 "still learning / mastered" 动作
2. **Stuck** — `stuck` 列表，提示这些词需要换记忆方式
3. **Recently added** — 最近 7 天加入的词
4. **Library snapshot** — 总数 + 按 status 分布
5. **Topics** — `topicMap` 前若干 tag

Dashboard 自己被编辑不应反触发递归同步（与 knowledge workspace 一致约束）。

## 为什么不能只做 template

如果只有 template，会立刻出现 4 个问题：

1. dashboard 会变成手写样例，一旦用户开始添加词，系统没有稳定同步语义。
2. "今天该复习什么"只能靠 agent 临时读文件推断，无法形成可预测的产品状态。
3. UI 没有专用 view，用户会被带回通用 tree-first 交互。
4. review 能力无法成立，因为没有统一读模型来判断什么是"卡住了"。

因此第一版必须是 plugin，不是单纯模板。

## 插件边界

Language workspace 作为一等 `workspaceKind` 落地，命名 `language`。

### Plugin 拥有

1. `languageTemplate`
2. `LanguagePluginConfig`（包含 review 阈值 N、stuck 阈值 X 等可配置项）
3. 读模型构建逻辑
4. dashboard 自动同步 job
5. domain API
6. workspace UI spec
7. language-specific agent instructions

### Plugin 不拥有

1. codoc CRUD 平台能力
2. parser 通用能力
3. 通用聊天 provider
4. MCP transport
5. 任何与其他 workspace 的耦合代码（跨 workspace 仅靠 `CodocPath` 引用，不直接读对方的 storage）

## UI 方案

第一版不做复杂新壳子，但要把 workspace 表现成 dashboard-first。

### 主页

默认打开 `dashboard.codoc`。

### Action Bar

至少提供：

1. `Sync dashboard`
2. `Review now`
3. `Add word`
4. `Lookup`（查词，未保存前是临时面板）

其中：

1. `Sync dashboard` 和 `Review now` 是真实 REST 动作
2. `Add word` 和 `Lookup` 可以先走 chat prompt（在 agent 完成前）

### Secondary Views

至少提供 3 个：

1. `Queue`
   展示完整 review queue（不只是 dashboard 上的前几条）
2. `Library`
   展示全部 word，可按 status / tags 过滤
3. `Review`
   展示 `stuck` 列表 + 结构性问题（缺 example、缺 tag 等）

这些 view 不直接读 word codoc 文件，而是只消费 plugin API 返回的读模型。

## API 方案

建议第一版 API 面如下：

| Method | Path | 作用 |
| --- | --- | --- |
| `GET` | `/api/plugins/language/overview` | 完整读模型 |
| `GET` | `/api/plugins/language/queue` | 只取 review queue |
| `GET` | `/api/plugins/language/library` | 全词列表 + 过滤 |
| `GET` | `/api/plugins/language/review` | 只取 review 视图（stuck + 结构性问题） |
| `POST` | `/api/plugins/language/sync` | 强制同步 dashboard |
| `POST` | `/api/plugins/language/review` | 运行一次 review 并更新 `lastReviewedAt` |
| `POST` | `/api/plugins/language/words` | 添加 word codoc（接收 optional `sourceCodocPath`） |
| `PATCH` | `/api/plugins/language/words/:codocPath` | 更新 status / tags / notes / lastReviewedAt（`:codocPath` URL-encode 后填入，与 Phase 0 §3 的 ref 模型一致） |

设计原则：

1. API 返回稳定读模型，不让前端自己拼状态。
2. `sync` 是幂等的。
3. `POST /words` 接收 optional `sourceCodocPath: CodocPath`——v1 内部不会被自身调用，但接口形状固定，未来从其他 workspace 跳过来添加词时复用同一路径。

## 自动同步策略

dashboard 必须自动维护，否则场景会退化回"你自己去编辑看板"。

建议第一版策略（与 knowledge 一致）：

1. workspace 打开时，如果 `dashboard` 过旧或未同步过，执行一次 catch-up sync
2. `words/` 下的 codoc 被更新后，debounce 一次 dashboard sync
3. 再加一个低频周期 sync 作为兜底

注意：

1. `dashboard.codoc` 自己变化不应反触发递归同步
2. `guide.codoc` 不参与同步

## Agent contract

这个场景的 agent 不能只是一句泛 prompt。它必须明确源数据和投影视图的边界。

至少要支持 4 类动作：

1. `ADD WORD`
   从用户输入或选中的英文片段创建一个 word codoc；如果调用方提供了 `sourceCodocPath`，写入 `sourceRefs`
2. `LOOKUP`
   查词后返回释义和例句，可选保存为 word codoc
3. `REVIEW`
   陪用户走今日 review queue，逐个标 `still learning` / `mastered`
4. `UPDATE WORD`
   更新状态、tags、notes、lastReviewedAt

关键规则：

1. word codoc 是事实源
2. `dashboard` 是 plugin 同步出的读模型
3. 不鼓励 agent 手工改写 dashboard 作为主要路径

Agent tool 形状约束（为未来联动预留）：

- `addWord` tool 的 input schema 必须包含 optional `sourceCodocPath: CodocPath` 字段
- v1 内 RSS 等其他 workspace 不会调用此 tool；但接口形状固定，未来 (B) 场景（"Send to vocab" from RSS）通过同一 tool 接通

v1 不注册 specialist agent。当前 `packages/service/src/usecases/agent/run-agent-turn.ts` 的 router + specialist 图是硬编码的，没有 plugin-registered specialist 机制。Language plugin 在 v1 内通过两条路径影响 agent 行为：

1. `getAgentInstructions()` 贡献 system prompt 段（在 Phase 0 接通之前，可临时把内容写进 `codoc.config.json.agentInstructions`）
2. `registerMcpTools()` 暴露 `addWord` / `lookup` / `updateWord` 等工具给 base / general agent 调用

specialist 注册机制是独立的未来 task，不在 v1 范围。

## 种子内容要求

为了让这个场景一开始就"完整"，种子内容不能只是占位符。

建议最小种子集：

1. 8 到 12 个 word codocs

要求：

1. 覆盖三种 status，而不是全部 `new`
2. 至少 1 个 `stuck`（learning 状态、`lastReviewedAt` 距今 ≥ 14 天），用来验证 review 视图
3. 至少 1 个带 `sourceRefs` 引用（即便引用的是种子里的一个占位 codoc），用来验证字段路径
4. 至少覆盖 3 到 4 个共享 tags，用来验证 topicMap
5. 至少 1 个缺 `exampleContext`，用来验证"结构性问题"检测

种子内容的作用不是展示文案，而是验证读模型和 review 逻辑。

## 跨 workspace 接口

第一版**不实现任何跨 workspace 联动**。所有"和 RSS 联动"的场景（高亮已学词 / RSS 选词收藏 / 主题学习计划）均不属于 v1。

但在数据契约层面保留以下两个 anchor，让未来场景 (B)（"Send to vocab" from RSS）可以以接线方式接通，不需要重构：

1. `word.sourceRefs: CodocPath[]`——一等字段，v1 多为空，未来由跨 workspace 调用方填入
2. `POST /words` 与 `addWord` tool 接收 optional `sourceCodocPath`——v1 内部不调用，但 schema 固定

明确**不预留**的内容：

1. spelling 反查索引（`lookupBySpelling`）——是场景 (A) 高亮的支撑，(A) 不值得做
2. cross-workspace agent / router 协议——是场景 (C) 学习计划的支撑，(C) 不值得做
3. RSS renderer 内的 `<KnownWord>` 组件注入——侵入式，已被 big-block 原则否定

这些都不在 v1 范围内，需要时再加。

## 实施顺序

宿主侧 4 项依赖（见上文"宿主侧依赖"）已落地，本 plan 从 Phase 1 起步。

### Phase 1: 领域收口

先确认：

1. word 字段
2. 状态语义与转移（含 `new` 在 reviewQueue 中的位置）
3. dashboard 读模型 shape
4. review 规则与阈值
5. 跨 workspace 数据契约（`sourceRefs: CodocPath[]` + tool signature）

产出：

1. 本文档
2. 对应的 TS 类型草案

### Phase 2: Plugin 后端

实现：

1. `plugins/language/`
2. config / detect / template 绑定
3. service 读模型计算
4. API routes
5. sync job

产出：

1. `language` 成为一等 `workspaceKind`
2. `dashboard` 可自动同步

### Phase 3: 前端专用视图

实现：

1. `home` 进入 `dashboard`
2. Queue / Library / Review 三个 plugin view
3. action bar 接线

产出：

1. 不再是 generic tree-first 体验

### Phase 4: Agent contract

实现：

1. `getAgentInstructions()` 返回 language-specific 段（依赖 Phase 0 已接通 plugin hook）
2. `registerMcpTools()` 暴露 `addWord` / `lookup` / `updateWord` 等工具，input schema 含 optional `sourceCodocPath: CodocPath`
3. 4 类动作（ADD / LOOKUP / REVIEW / UPDATE）通过 base / general agent + 上述工具组合表达

产出：

1. AI 作为增强层而不是唯一入口
2. **不**注册 specialist agent；specialist 注册留到 service 层支持后再加

### Phase 5: 验证

验证项：

1. `init --from language`
2. 默认进入 `dashboard`
3. 添加 / 复习 word 后 dashboard 自动更新
4. Queue / Library / Review 能给出稳定结果
5. `typecheck / build / init / compile` 全通过

## 验收标准

只有当下面这些都成立，才算"完整开始"：

1. Language workspace 不是 template demo，而是 plugin-backed vertical
2. 用户有清晰主路径，不需要先理解目录结构
3. dashboard 是自动维护的读模型，不是手写页面
4. review 机制能区分"今日要复习"和"卡住的"
5. 核心 review 循环即使没有 AI 也能走通
6. `word.sourceRefs: CodocPath[]` 和 `addWord` tool 的 `sourceCodocPath` 在接口层面已就位，即便 v1 内部从不使用
7. v1 **不**注册 specialist agent；plugin 通过 `getAgentInstructions()` + `registerMcpTools()` 影响 base / general agent

## 当前结论

下一步不应继续先写模板或先做几个示例 word codoc，而应先进入 **Phase 1: 领域收口**，把：

1. word 字段
2. 状态语义
3. dashboard shape
4. review 规则与阈值
5. 跨 workspace 数据契约 anchor

先定死，再开始实现。
