# 对话式创建：从空白画布到结构化知识

> Cobook 的核心叙事不是"展示预置文档"，而是"通过对话从零构建并迭代知识资产"。本文档细化三个方向的设计：Agent 能力补全、初始状态设计、Demo 叙事。

---

## 目录

1. [设计动机](#1-设计动机)
2. [方向一：Agent 能力补全](#2-方向一agent-能力补全)
3. [方向二：初始状态设计](#3-方向二初始状态设计)
4. [方向三：Demo 叙事](#4-方向三demo-叙事)
5. [实施计划](#5-实施计划)

---

## 1. 设计动机

当前 demo 是两个预置的咖啡豆 codoc（`yirgacheffe.codoc` + `brew-guide.codoc`），展示的是"打开 → 浏览 → 在 chat 中提问 → agent 修改字段 → 跨文档传播"。这本质上是一个**成品展厅**——用户看到的是"codoc 能做什么"，而不是"我能用 codoc 做什么"。

新叙事的核心转变：

| | 旧 | 新 |
|--|---|----|
| 起点 | 预置好的完整文档 | 空白画布 + 模糊需求 |
| 过程 | 浏览 + 提问 + 修改字段值 | 对话 → 结构涌现 → 迭代细化 |
| 终点 | 看到字段传播的 demo 效果 | 一套可工作的知识资产（用户亲手创造的） |
| 说服力来源 | codoc 引擎的技术能力 | "从想法到结构化产物"的完整路径 |

锚定的目标案例（替代咖啡豆）：
1. **信息看板** — 聚合飞书、内部 QA 系统等消息源的团队看板
2. **Skill 模板** — 可复用的 prompt skill，保存在左栏供团队同事使用

这两个案例不是预置的，而是用户在对话中"生长"出来的。

---

## 2. 方向一：Agent 能力补全

> 优先级最高。如果 agent 无法从对话中创建和迭代 codoc，后面的一切都是空谈。

### 2.1 能力缺口分析

| 能力 | 现状 | 缺口 |
|------|------|------|
| 创建 codoc | `create-codoc` intent 类型已定义，payload `{ docId, content }` 已有 | intent 执行器是 TODO，Workspace 无 `createDoc` API |
| 整文档重写 | 无 | 迭代 schema 结构时需要替换整个文档（加字段、改类型、调 view） |
| 从需求推导结构 | codoc-agent 的 system prompt 只教了 CRUD | 需要教 agent 理解需求 → 设计 schema → 生成完整 YAML |
| 多轮迭代保持上下文 | chat-history 作为 optional context，maxTokens: 1000 | 创建场景下 chat-history 更重要，token 预算需调大 |
| 无 codoc 时的 daemon 触发 | daemon filter 依赖 `resourceKinds: ["codoc"]` | workspace 为空时没有 codoc resource，用户消息不会触发 codoc-agent |

### 2.2 Workspace API 扩展

在 `packages/core/src/workspace.ts` 的 `Workspace` 类上新增两个方法：

```typescript
/**
 * 创建新 codoc 文件并注册到索引。
 * 写入 YAML 到 docs 目录，解析并更新内部索引。
 * 如果 docId 已存在则抛出错误。
 */
async createDoc(docId: string, yamlContent: string): Promise<DocMeta>

/**
 * 覆盖已有 codoc 文件的全部内容。
 * 重新解析 → 更新索引 → 卸载旧 runtime（如果已加载）。
 * 如果 docId 不存在则抛出错误。
 */
async rewriteDoc(docId: string, yamlContent: string): Promise<DocMeta>
```

#### `createDoc` 实现要点

```
1. 校验 docId 格式（必须以 .codoc 结尾，不含路径分隔符）
2. 校验不存在同名文档
3. writeFile(join(this.dir, docId), yamlContent)
4. parseCodoc(yamlContent) → 校验 YAML 合法性
5. 更新 this.parsed / this.index
6. 返回 DocMeta
```

#### `rewriteDoc` 实现要点

```
1. 校验 docId 已存在
2. 如果该文档已 loadDoc（runtime 在 registry 中）：
   a. 取消所有 field subscription
   b. 从 registry 中移除
3. writeFile(join(this.dir, docId), yamlContent)
4. parseCodoc(yamlContent) → 更新 this.parsed / this.index
5. 返回新的 DocMeta
   （不自动 loadDoc — 下次访问时按需加载）
```

### 2.3 Intent 执行器补全

在 `codoc-use/intent.ts` 中补全 `create-codoc` 和新增 `rewrite-codoc`：

#### 新增 intent 类型

```typescript
// codoc-use/types.ts

export type CodocIntentKind =
  | "write-codoc-field"
  | "create-codoc"
  | "rewrite-codoc"      // 新增：整文档重写（schema + data + view）
  | "delete-codoc"
  | "force-codoc-field";

export interface RewriteCodocPayload {
  docId: string;
  content: string;        // 完整 YAML
  changelog?: string;     // agent 对本次变更的说明
}
```

#### 执行器实现

```typescript
// codoc-use/intent.ts

case "create-codoc": {
  const { docId, content } = intent.payload as CreateCodocPayload;
  const meta = await workspace.createDoc(docId, content);
  // 创建后自动 loadDoc，让字段开始求值
  workspace.loadDoc(docId);
  break;
}

case "rewrite-codoc": {
  const { docId, content } = intent.payload as RewriteCodocPayload;
  await workspace.rewriteDoc(docId, content);
  // 重写后自动 loadDoc
  workspace.loadDoc(docId);
  break;
}
```

### 2.4 codoc-agent 增强

#### 2.4.1 触发模式调整

当前 codoc-agent 只在 `resourceKinds: ["codoc"]` 时触发。workspace 为空时，用户的第一条消息不包含任何 codoc resource ref，daemon 不会触发。

**方案**：为 codoc-agent 的 TriggerFilter 增加 `keywords` 条件，让创建类的关键词也能触发：

```typescript
responseMode: {
  type: "daemon",
  filter: {
    resourceKinds: ["codoc"],
    keywords: ["创建", "新建", "搭建", "做一个", "create", "build", "make"],
  },
},
```

> 注意：当前 Bus 的 TriggerFilter 对多个字段做 AND 匹配。需要改为 OR 语义（任一条件命中即触发），或者将 keywords 作为独立的触发路径。详见下方 2.5。

#### 2.4.2 System Prompt 重写

当前 system prompt 只教了字段级 CRUD。需要扩展为两个模式：

**创建模式**（workspace 中无 codoc，或用户明确要求创建）：

```
你是 Codoc，一个结构化文档管理 agent。

当用户描述一个需求时，你需要：
1. 理解需求的核心实体和字段
2. 设计 codoc 结构（type + data + view）
3. 用 <intent> 块提议创建

设计原则：
- type 中用 JSON Schema 定义字段类型
- data 中区分 literal（用户明确给出的值）和 $prompt（需要 AI 生成的值）
- 如果字段的值需要依赖其他字段，用 $ref 或 $prompt 模板变量
- view 用 MDX 渲染，可用组件：Badge, InfoRow, Highlight, AIBlock
- 命名用英文 kebab-case（如 team-board.codoc）
- 先解释你的设计思路，再给出 intent

创建 intent 格式：
<intent>
{"kind": "create-codoc", "payload": {"docId": "xxx.codoc", "content": "YAML 内容"}}
</intent>

当用户要求修改已有 codoc 的结构（加字段、改类型、调 view）时，使用整文档重写：
<intent>
{"kind": "rewrite-codoc", "payload": {"docId": "xxx.codoc", "content": "完整 YAML", "changelog": "变更说明"}}
</intent>

当只需修改某个字段的值时，使用字段写入（无需重写整个文档）：
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "xxx.codoc", "field": "/path", "value": "new value"}}
</intent>
```

**关键指令**：

```
回复策略：
- 先用 1-2 句话解释你的设计决策（为什么选这些字段、为什么用 $prompt 而非 literal）
- 再给出 intent 块
- 如果需求模糊，先提问澄清，不要猜测
- 用户迭代时，只改变更的部分并解释改了什么
- 用中文回复（当用户用中文时）
```

#### 2.4.3 上下文需求调整

创建场景下，chat-history 比 codoc-snapshot 更重要（因为可能还没有 codoc）：

```typescript
contextRequirements: [
  { sourceKind: "chat-history", priority: "required", maxTokens: 3000 },
  { sourceKind: "codoc-snapshot", priority: "optional" },
],
```

> 这是一个权衡：把 chat-history 从 optional (1000 tokens) 提升为 required (3000 tokens)。代价是 codoc-agent 的每次调用消耗更多 token。但创建场景下，对话上下文是理解用户需求的唯一来源，不可裁剪。

### 2.5 Bus TriggerFilter 语义调整

当前 `matchesTriggerFilter()` 对 filter 的多个字段做 AND：

```typescript
// 当前行为：resourceKinds AND intentKinds AND keywords 都要满足
```

对话式创建场景需要 OR 语义：用户说"帮我创建一个看板"时消息没有 codoc resource ref，但有关键词。两个条件是"任一满足即触发"。

**方案**：将 filter 改为 OR 语义——filter 中声明的多个字段，任一匹配即通过：

```typescript
function matchesTriggerFilter(filter: TriggerFilter, message: Message): boolean {
  // 空 filter = 不匹配任何消息
  const checks: boolean[] = [];

  if (filter.resourceKinds?.length) {
    checks.push(
      message.resourceRefs?.some(r => filter.resourceKinds!.includes(r.kind)) ?? false
    );
  }
  if (filter.intentKinds?.length) {
    checks.push(
      message.intents?.some(i => filter.intentKinds!.includes(i.kind)) ?? false
    );
  }
  if (filter.keywords?.length) {
    const lower = message.content.toLowerCase();
    checks.push(filter.keywords.some(kw => lower.includes(kw.toLowerCase())));
  }
  if (filter.fromParticipants?.length) {
    checks.push(filter.fromParticipants.includes(message.sender.participantId));
  }

  // OR：任一条件组命中即通过
  return checks.length > 0 && checks.some(Boolean);
}
```

> 影响范围：需要审查现有 daemon agent 的 filter 定义，确认 OR 语义不会导致误触发。当前只有 codoc-agent 是 daemon，其他 agent 都是 on-mention，不受影响。

### 2.6 UI 侧：codoc 创建后的左栏更新

当 `create-codoc` intent 被 confirmed 并执行后，左栏 CodocList 需要感知新文档：

```
create-codoc 执行
  → workspace.createDoc()
  → workspace 发出变更事件（新增文档）
  → SSE 推送事件到客户端
  → WorkspaceStore 更新 docs 列表
  → CodocList 重新渲染，新文档出现
```

需要新增一种 SSE 事件类型 `doc-created`（当前只有 `field` 事件）。或者客户端在收到 chat 中 create-codoc intent confirmed 后主动 refetch workspace。

**推荐方案**：client 端在检测到 `create-codoc` intent 状态变为 confirmed 时，调用 `GET /api/workspace` 刷新文档列表。简单直接，不需要改 SSE 协议。

同理，`rewrite-codoc` confirmed 后也需要刷新文档详情。

---

## 3. 方向二：初始状态设计

### 3.1 空白 Workspace

删除 `docs/yirgacheffe.codoc` 和 `docs/brew-guide.codoc`。`docs/` 目录保留但为空。

启动后的状态：
- 左栏 CodocList：空，显示引导文案"通过对话创建你的第一个 codoc"
- 中间 ChatArea：空状态，显示引导卡片
- 右栏 AgentsPanel：正常显示 4 个 agent

### 3.2 ChatArea 空状态增强

当前空状态是一个简单的 "Start a conversation" 提示。替换为可交互的引导卡片：

```
┌─────────────────────────────────────────────┐
│                                             │
│         [Sparkles icon]                     │
│                                             │
│     开始创建你的第一个 codoc                  │
│     描述你的需求，AI 会帮你设计结构            │
│                                             │
│  ┌─────────────────────┐  ┌─────────────────┐
│  │ 📋 搭建飞书消息看板   │  │ 🛠 创建周报 Skill │
│  │ 聚合飞书、QA 系统    │  │ 团队可复用的      │
│  │ 等消息源             │  │ prompt 模板       │
│  └─────────────────────┘  └─────────────────┘
│                                             │
│  ┌─────────────────────┐  ┌─────────────────┐
│  │ 📊 项目进度跟踪      │  │ ✨ 自由创建       │
│  │ 汇总 Linear/Jira    │  │ 描述你想做的      │
│  │ 任务状态             │  │ 任何东西          │
│  └─────────────────────┘  └─────────────────┘
│                                             │
└─────────────────────────────────────────────┘
```

**交互**：点击卡片 → 将对应的 prompt 填入 ChatInput：
- "搭建飞书消息看板" → `帮我搭建一个信息看板，消息源来自飞书群和内部 QA 系统`
- "创建周报 Skill" → `帮我创建一个周报生成的 skill，让团队同事可以复用`
- "项目进度跟踪" → `帮我创建一个项目进度跟踪文档，汇总 Linear 的任务状态`
- "自由创建" → 聚焦到输入框，不填入文字

填入后不自动发送，用户可以编辑补充后再发。

### 3.3 CodocList 空状态

左栏在无文档时的显示：

```
┌──────────────┐
│  Resources   │
│              │
│  (empty)     │
│              │
│  在对话中创建 │
│  你的第一个   │
│  codoc       │
│              │
│  创建完成后   │
│  文档会出现   │
│  在这里       │
└──────────────┘
```

文档创建后，列表自动刷新，新条目带一个短暂的 highlight 动画引导用户注意。

---

## 4. 方向三：Demo 叙事

### 4.1 叙事结构

五幕结构，每一幕展示一个核心能力：

```
场景 1  空白画布          → 引导设计
场景 2  第一个 codoc 诞生  → 对话式创建
场景 3  迭代细化          → 结构演化
场景 4  衍生第二个 codoc   → 跨文档引用
场景 5  传播              → 响应式联动
```

### 4.2 场景详细设计

#### 场景 1：空白画布

**用户看到**：空 workspace，中间区域有引导卡片。

**用户操作**：点击"搭建飞书消息看板"卡片。

**输入框填入**：`帮我搭建一个信息看板，消息源来自飞书群和内部 QA 系统`

**展示能力**：onboarding 设计、降低使用门槛。

---

#### 场景 2：第一个 codoc 诞生

**用户操作**：发送消息。

**codoc-agent 响应**（daemon 被 keywords 触发）：

```
看板的核心是"从哪里来"和"关注什么"。我设计了这样的结构：

- **name**：看板名称（literal）
- **platform / channels**：消息来源配置（literal）
- **filterTags**：关注的标签，用于筛选消息（literal）
- **refreshInterval**：更新频率（literal）
- **digest**：AI 自动生成的看板摘要（$prompt，依赖 name + channels + filterTags）

$prompt 字段会在看板配置变更时自动重新生成。

[IntentCard: create-codoc team-board.codoc]
  预览：完整 YAML 内容
  [Confirm] [Reject]
```

**用户操作**：查看 IntentCard 中的预览 → 点击 Confirm。

**系统响应**：
1. `create-codoc` intent 执行 → `docs/team-board.codoc` 写入磁盘
2. 左栏出现 `team-board.codoc` 条目（带 highlight 动画）
3. $prompt 字段 `/digest` 开始求值 → 状态 pending → resolved
4. Chat 中出现系统消息："codoc **team-board.codoc** 创建完成。"

**展示能力**：从自然语言到结构化文档的全过程、intent 预览确认机制。

---

#### 场景 3：迭代细化

**用户操作**：
```
加一个优先级过滤，只看 P0 和 P1 的消息。
另外 refreshInterval 改成每 30 分钟。
```

**codoc-agent 响应**：

```
好的，需要做两个变更：

1. 在 schema 中新增 `priorityFilter` 字段（array 类型），默认值 ["P0", "P1"]
2. 将 `refreshInterval` 的值从"每小时"改为"每30分钟"

因为新增了字段，需要整文档重写：

[IntentCard: rewrite-codoc team-board.codoc]
  changelog: 新增 priorityFilter 字段，修改 refreshInterval
  预览：完整 YAML（diff 高亮变更部分）
  [Confirm] [Reject]
```

**用户操作**：确认。

**系统响应**：
1. `rewrite-codoc` 执行 → 文档更新
2. `/digest` 字段因依赖的字段集变了 → 标脏 → 自动重新生成
3. 系统消息通知字段变更

**用户继续**：
```
摘要写得太简单了，帮我润色一下
```

**用户操作**：输入 `@polish-agent 帮我润色 digest 字段`

**展示能力**：结构级迭代（rewrite）+ 值级修改（write）+ agent 间协作（polish → write intent → codoc-agent 检测 → 用户确认）。

---

#### 场景 4：衍生 — Skill 的诞生

**用户操作**：
```
能不能基于这个看板，做一个周报生成的 skill？让团队同事也能用。
```

**codoc-agent 响应**：

```
好主意。我会创建一个 skill 文档，通过 $ref 引用看板的配置：

- **skillName**：skill 名称（literal）
- **boardName**：$ref → team-board.codoc /name（实时同步看板名称）
- **boardTags**：$ref → team-board.codoc /filterTags（实时同步标签）
- **targetRole**：目标角色（literal，如"后端工程师"）
- **tone**：输出风格（literal，如"简洁专业"）
- **generatedPrompt**：$prompt，基于以上所有字段自动生成可复用的 prompt 模板

这样看板的标签或名称变了，skill 的 prompt 会自动更新。

[IntentCard: create-codoc report-skill.codoc]
  预览：完整 YAML（$ref 引用高亮）
  [Confirm] [Reject]
```

**用户操作**：确认。

**系统响应**：
1. `report-skill.codoc` 创建
2. 左栏出现第二个文档
3. $ref 字段 resolve → 从 team-board 拉取值
4. $prompt 字段基于 resolve 后的值生成 prompt 模板
5. 图谱视图（如果切换过去）显示两个文档的依赖连线

**展示能力**：跨文档 $ref、从现有文档衍生新文档、依赖图可视化。

---

#### 场景 5：传播 — 牵一发动全身

**用户操作**：
```
看板的关注标签加上"安全漏洞"
```

**codoc-agent 响应**：

```
[IntentCard: write-codoc-field team-board.codoc /filterTags]
  value: ["P0", "P1", "发版", "线上问题", "安全漏洞"]
  [Confirm] [Reject]
```

**用户操作**：确认。

**系统响应**（自动传播链）：

```
1. team-board.codoc /filterTags 更新
2. team-board.codoc /digest 标脏 → 重新生成（依赖 filterTags）
3. report-skill.codoc /boardTags 标脏 → 重新 resolve（$ref 传播）
4. report-skill.codoc /generatedPrompt 标脏 → 重新生成（依赖 boardTags）
```

Chat 中依次出现系统消息：
```
codoc team-board.codoc field '/filterTags' changed.
codoc team-board.codoc field '/digest' changed.
codoc report-skill.codoc field '/boardTags' changed.
codoc report-skill.codoc field '/generatedPrompt' changed.
```

**展示能力**：响应式传播 — 改一个值，下游自动更新，跨文档联动。

### 4.3 叙事的关键说服点

1. **用户全程没写过一行 YAML**。所有结构和内容都是对话中涌现的。
2. **结果是结构化的、可追踪的**。不是一段聊天记录，而是持久化的 codoc 文档，有 schema、有依赖图、有版本。
3. **可迭代**。加字段、改结构、润色内容，都在同一个对话流中完成，不需要切换工具。
4. **可衍生**。一个 codoc 可以 $ref 另一个 codoc，形成知识网络，修改自动传播。
5. **团队可复用**。skill 保存在左栏，任何同事打开 workspace 都能看到和使用。

---

## 5. 实施计划

### 5.1 优先级

```
P0  Workspace.createDoc / rewriteDoc API          → 场景 2/3 的基础
P0  create-codoc / rewrite-codoc intent 执行器     → 打通 agent → 文件系统
P0  codoc-agent system prompt 重写                 → 创建能力的核心
P0  Bus TriggerFilter OR 语义                      → 空 workspace 时能触发 agent

P1  ChatArea 空状态引导卡片                         → 场景 1 的入口
P1  CodocList 空状态 + 创建后自动刷新               → 场景 2 的反馈
P1  codoc-agent contextRequirements 调整            → 创建场景的上下文质量

P2  IntentCard 支持 YAML 预览 + diff 高亮           → 场景 3 的可读性
P2  删除旧 demo 文件 + 更新测试                     → 收尾
P2  更新 LINEAR-WALKTHROUGH.md                     → 文档同步
```

### 5.2 阶段划分

#### Phase A：打通创建链路（P0）

```
Workspace API
  ├→ Workspace.createDoc()
  └→ Workspace.rewriteDoc()

Intent 执行
  ├→ 新增 RewriteCodocPayload 类型
  ├→ executeCodocIntent 补全 create-codoc
  └→ executeCodocIntent 新增 rewrite-codoc

Agent
  ├→ codoc-agent system prompt 重写
  ├→ codoc-agent contextRequirements 调大 chat-history
  └→ codoc-agent trigger filter 加 keywords

Bus
  └→ matchesTriggerFilter 改为 OR 语义

验证：手动测试 — 在 chat 中说"帮我创建一个看板" → agent 提议 → confirm → 文件创建 → 左栏出现
```

#### Phase B：初始状态 + 引导（P1）

```
UI
  ├→ ChatArea 空状态引导卡片组件
  ├→ CodocList 空状态文案
  ├→ CodocList 创建后自动刷新（检测 create-codoc confirmed）
  └→ 新条目 highlight 动画

Demo 文件
  └→ 删除 docs/yirgacheffe.codoc、docs/brew-guide.codoc

验证：冷启动 → 看到引导 → 点击卡片 → 走完场景 1-2
```

#### Phase C：体验打磨（P2）

```
UI
  ├→ IntentCard YAML 预览（语法高亮）
  └→ rewrite-codoc IntentCard diff 视图（变更高亮）

文档
  ├→ 更新 LINEAR-WALKTHROUGH.md
  └→ 更新测试用例
```

### 5.3 文件变更清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/workspace.ts` | 新增 `createDoc()`, `rewriteDoc()` |
| `packages/core/src/__tests__/workspace.test.ts` | 新增对应测试 |
| `apps/cobook/src/codoc-use/types.ts` | 新增 `rewrite-codoc`, `RewriteCodocPayload` |
| `apps/cobook/src/codoc-use/intent.ts` | 补全 `create-codoc`, 新增 `rewrite-codoc` 执行 |
| `apps/cobook/src/agents/codoc-agent.ts` | system prompt 重写, contextRequirements 调整, filter 加 keywords |
| `apps/cobook/src/chat/bus.ts` | `matchesTriggerFilter` 改 OR 语义 |
| `apps/cobook/src/chat/__tests__/bus.test.ts` | 更新 filter 测试 |
| `apps/cobook/src/workspace/components/ChatArea.tsx` | 空状态引导卡片 |
| `apps/cobook/src/workspace/components/CodocList.tsx` | 空状态 + 创建后刷新 |
| `apps/cobook/docs/yirgacheffe.codoc` | 删除 |
| `apps/cobook/docs/brew-guide.codoc` | 删除 |
