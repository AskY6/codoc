# Cobook Linear Walkthrough

> 一篇按人类阅读顺序组织的设计与实现导读。从最底层的概念开始，逐层向上，每一层只依赖前面已经解释过的内容。

---

## 目录

1. [全局图景：Codoc 和 Cobook 是什么](#1-全局图景)
2. [底座：@codoc/core — 响应式文档引擎](#2-底座codoccore)
3. [第一层：Chat Ability — 通用多参与者对话能力](#3-第一层chat-ability)
4. [第二层 A：Codoc Use — 将 codoc 接入对话](#4-第二层-acodoc-use)
5. [第二层 B：Agents — 对话中的专业参与者](#5-第二层-bagents)
6. [第三层：Workspace — 组装一切并呈现 UI](#6-第三层workspace)
7. [运行时数据流：一次完整的用户交互](#7-运行时数据流)
8. [目录结构速查](#8-目录结构速查)

---

## 1. 全局图景

**Codoc** 是一种文档格式（`.codoc` 文件，YAML）。每个 codoc 文档由 **schema**（JSON Schema）定义字段结构，由 **loader** 声明每个字段的值从哪里来（手写的字面量、引用其他字段、HTTP 获取、LLM 生成、跨文档引用）。字段之间形成依赖图，修改一个字段会自动向下游传播标脏。

**Cobook** 是基于 codoc 构建的第一个应用——一个以对话为中心的知识工作台。用户在群聊中与多个具名 AI agent 协作，通过 "@mention + intent 确认" 的交互模式操作 codoc 文档。

两者的关系：

```
┌──────────────────────────────────────────┐
│  Cobook（应用）                            │
│  对话 UI + agent + codoc 操作              │
├──────────────────────────────────────────┤
│  @codoc/core（引擎）                       │
│  文档解析 + 依赖图 + 响应式求值 + 跨文档传播  │
└──────────────────────────────────────────┘
```

Cobook 内部再分为四层（自底向上）：

```
┌─────────────────────────────────────────┐
│  Workspace（组装 + UI）                   │
├──────────────┬──────────────────────────┤
│  Agents      │  Codoc Use              │
│  参与者定义    │  core 适配层             │
├──────────────┴──────────────────────────┤
│  Chat Ability（通用对话能力）              │
├─────────────────────────────────────────┤
│  @codoc/core                            │
└─────────────────────────────────────────┘
```

**分层原则**：上层不穿透下层 API。Chat Ability 不知道 codoc 的存在；Codoc Use 不知道有哪些 agent；Agents 不直接调用 core。

---

## 2. 底座：@codoc/core

> 代码位置：`packages/core/src/`

### 2.1 一个 .codoc 文件长什么样

```yaml
type:                          # JSON Schema，定义字段类型
  title: { type: string }
  revenue: { type: number }
  summary: { type: string }

data:                          # 每个字段的值 + 来源声明
  title:
    $value: "Q1 报告"          # literal loader — 手写的值
  revenue:
    $source: "https://api.example.com/revenue"  # source loader — HTTP 获取
    ttl: 300
  summary:
    $prompt:                    # prompt loader — LLM 生成
      template: "根据标题 {title} 和收入 {revenue} 写一段总结"

view: |                        # MDX 模板，用于渲染
  # {title}
  收入：<CodataValue path="/revenue" />
  总结：<CodataValue path="/summary" />
```

核心要素：
- **schema**（`type`）：用 JSON Schema 校验字段值
- **loader**（`data` 中的 `$value`/`$source`/`$prompt`/`$ref`/`$external`）：声明字段值的来源
- **view**：可选的 MDX 渲染模板

### 2.2 五种 Loader

| Loader | 声明方式 | 含义 | 是否产生依赖 |
|--------|---------|------|-------------|
| literal | `$value: 42` | 静态值 | 否 |
| ref | `$ref: "/title"` | 引用同文档另一字段 | 是（指向目标字段） |
| source | `$source: "https://..."` | HTTP 获取 | 否（但有 TTL 缓存） |
| prompt | `$prompt: { template: "..." }` | LLM 生成 | 是（模板中的 `{fieldName}` 变量） |
| external | `$external: { docRef: "B.codoc", fieldPath: "/title" }` | 跨文档引用 | 是（跨文档依赖） |

> 实现：`packages/core/src/loader/` 下 `literal.ts`、`ref.ts`、`source.ts`、`prompt.ts`、`external.ts`

### 2.3 DataTree — 字段状态管理

`DataTree`（`packages/core/src/data-tree.ts`）管理一个文档内所有字段的生命周期。

**字段状态机**：

```
idle → pending → resolved
                → error
resolved/error → dirty（被下游标脏）→ pending → ...
```

关键操作：
- `observe(path)` — 如果字段未求值，触发求值（force），返回最终值。这是最常用的 API。
- `force(path)` — 内部求值：调用 loader，校验 schema，处理循环引用检测
- `invalidateField(path)` — 标脏：将 resolved/error 状态的字段标为 dirty
- `updateField(path, value)` — 外部写入：直接设置字段值
- `subscribe(listener)` — 订阅字段变更通知

### 2.4 DAG — 依赖图

`DAG`（`packages/core/src/dag.ts`）跟踪文档内字段间的依赖关系。

```
summary → title     （summary 依赖 title）
summary → revenue   （summary 依赖 revenue）
```

由 `extractAllDeps(tree)` 从 DataTree 中提取：ref loader 直接产生边，prompt loader 的模板变量（`{title}`）也产生边。

DAG 支持：
- 拓扑排序（`topoSort` / `topoLayers`）— 决定求值顺序
- 循环检测（`detectCycle`）— Kahn 算法
- 脏传播（`propagateDirty`）— BFS 找出所有受影响的下游字段

### 2.5 Workspace — 多文档管理

`Workspace`（`packages/core/src/workspace.ts`）是 core 对外的主入口。

```typescript
const workspace = await Workspace.create("./docs");

workspace.listDocs();           // → DocMeta[]  文档列表
workspace.loadDoc("report.codoc"); // → CodocRuntime { tree, dag }
workspace.getDependencyGraph();  // → 全局依赖图（跨文档）
workspace.onFieldChange(cb);     // → 订阅任意字段变更
```

Workspace 内部维护 `DocRegistry`（`doc-registry.ts`），管理已加载文档和跨文档订阅。当文档 A 的字段引用了文档 B 的字段（external loader），`wireExternalDeps` 会建立订阅，B 的字段变更自动传播到 A。

### 2.6 调度与传播

- `scheduleForce(tree, dag)` — 按拓扑层级批量求值所有字段：同层并发，跨层顺序
- `propagateAndInvalidate(dag, tree, changedPaths)` — 标脏 + BFS 传播到所有下游
- `crossDocPropagate(registry, docId, changedPaths)` — 跨文档传播：找到所有消费者文档，标脏并重新求值

**小结**：@codoc/core 提供了一个响应式文档引擎——声明式定义字段和来源，自动跟踪依赖，修改后自动传播。它不知道 UI、不知道 AI agent，只管数据。

---

## 3. 第一层：Chat Ability

> 代码位置：`apps/cobook/src/chat/`
>
> Chat Ability 是一个**通用的多参与者对话能力层**。它不知道 codoc 的存在，不知道自己被用在知识管理场景。如果明天要做一个 "co-code" 应用，这一层可以整层复用零修改。

### 3.1 核心类型（`chat/types.ts`）

**Participant（参与者）**：

```typescript
interface Participant {
  id: string;
  kind: "human" | "agent";
  name: string;
  description: string;
  contextRequirements?: ContextRequirement[];  // 需要什么上下文
  responseMode: ResponseMode;                   // 何时响应
}
```

**Message（消息）**：

```typescript
interface Message {
  id: string;
  sender: ParticipantRef;
  content: string;
  quotedIds?: string[];              // 引用其他消息
  resourceRefs?: ResourceRef[];      // 引用的外部资源
  mentionedParticipants?: string[];  // @mention 了谁
  intents?: Intent[];                // 结构化的行动意图
  timestamp: number;
}
```

消息不只有文本。`resourceRefs` 关联外部资源，`intents` 声明行动意图，`mentionedParticipants` 触发 agent。

**ResourceRef（资源引用）**：

```typescript
interface ResourceRef {
  kind: string;   // 由应用层定义，如 "codoc"
  id: string;
  label?: string;
}
```

Chat 不知道 "codoc" 是什么，只负责传递这个引用。

**Intent（意图）**：

```typescript
interface Intent {
  kind: string;                                  // 由应用层定义，如 "write-codoc-field"
  payload: unknown;
  status: "proposed" | "confirmed" | "rejected";
}
```

Intent 是"先预览再操作"的通用机制。Agent 提出 intent（proposed）→ 用户确认（confirmed）→ 应用层执行。

**ResponseMode（响应模式）**：

```typescript
type ResponseMode =
  | { type: "on-mention" }   // 被 @mention 时才响应
  | { type: "daemon"; filter: TriggerFilter }  // 持续监听，自主判断
  | { type: "passive" }      // 从不主动响应
```

### 3.2 Session（`chat/session.ts`）

Session 是对话容器。一个 Session 包含：
- **participants** — 参与者列表
- **contextSources** — 注册的上下文源
- **messageTree** — 消息树（支持分支）

`MessageTree` 管理消息的树状结构：

```typescript
class MessageTree {
  addMessage(msg, parentId?)   // 追加消息
  getActiveBranch()            // 获取当前活跃分支（根到叶的路径）
  branchAt(msgId)              // 在某条消息处创建分支
  switchBranch(leafId)         // 切换到另一条分支
}
```

消息不是线性列表，是树。一条消息可以有多个子消息（分支），"当前对话"是从根到某个叶子的路径。

### 3.3 上下文组装（`chat/context.ts`）

当 agent 被触发时，不是把所有信息都塞进 prompt。而是按 agent 声明的需求，从可用的上下文源中按需组装。

```typescript
interface ContextSource {
  kind: string;                      // "chat-history" / "codoc-snapshot" / ...
  resolve(): Promise<ContextData>;   // 惰性解析
}

interface ContextRequirement {
  sourceKind: string;                // 需要哪种源
  priority: "required" | "optional";
  maxTokens?: number;                // token 预算
}
```

`assembleContext()` 函数的逻辑：
1. 读取 agent 的 `contextRequirements`
2. 从 session 的 `contextSources` 和 `contextSourceFactories` 中找到匹配的源
3. 并行 resolve 所有源
4. 按优先级排序（required 在前），超预算时裁剪 optional 部分

**ContextSourceFactory** 是按需创建上下文源的工厂。当用户 reference 一个 codoc 进 chat，工厂按 ResourceRef 自动创建对应的 ContextSource。

### 3.4 消息路由（`chat/bus.ts`）

消息进入 Chat Bus 后的路由逻辑：

```
Message 进入 →
  ├→ on-mention agent：检查 mentionedParticipants 是否包含自己 → 匹配则触发
  ├→ daemon agent：过 TriggerFilter（resourceKinds / intentKinds / keywords）→ 通过则触发
  └→ passive agent：跳过
```

**TriggerFilter** 是零成本的规则匹配（if/else），不涉及 LLM：

```typescript
interface TriggerFilter {
  fromParticipants?: string[];   // 只看特定发送者
  resourceKinds?: string[];      // 只看包含特定资源类型的消息
  intentKinds?: string[];        // 只看包含特定 intent 类型的消息
  keywords?: string[];           // 关键词匹配
}
```

**防循环机制**：
- Agent A 的回复可能触发 Agent B（群聊的正常行为），但 `maxChainDepth`（默认 3）限制响应链深度
- 同一 agent 对同一条消息只响应一次（去重）
- daemon agent 有冷却期（`cooldownMs`），避免高频触发

### 3.5 事件系统（`chat/events.ts`）

`SessionEventEmitter` 是简单的 per-session 事件发射器：

```typescript
interface ChatEvents {
  onMessage: (msg: Message) => void;
  onIntentStatusChange: (msgId, intentIdx, status) => void;
  onBranchSwitch: (activePath: string[]) => void;
  onParticipantJoin: (participant) => void;
  // ...
}
```

应用层通过这些事件感知 chat 的状态变化。

### 3.6 对外接口（`chat/index.ts`）

`createChatAbility()` 返回 `ChatAbility` 接口——chat 层的全部公开能力：

```typescript
interface ChatAbility {
  createSession(config): Session;
  registerParticipant(sessionId, participant): void;
  registerContextSource(sessionId, source): void;
  registerContextSourceFactory(sessionId, factory): void;
  addResourceRef(sessionId, ref): void;
  removeResourceRef(sessionId, refId): void;
  sendMessage(sessionId, msg): Message;
  updateIntentStatus(sessionId, msgId, idx, status): void;
  getMessages(sessionId): Message[];
  getParticipants(sessionId): Participant[];
  getIntent(sessionId, msgId, idx): Intent;
  branchAt(sessionId, msgId): string;
  switchBranch(sessionId, leafMsgId): void;
  on<K>(sessionId, event, handler): Unsubscribe;
}
```

`sendMessage()` 内部会触发异步路由：消息进入 Bus → 找到被触发的 agent → 组装上下文 → 执行 handler → handler 产出的回复再次进入 Bus（响应链）。这是 fire-and-forget 模式，不阻塞 `sendMessage()` 的返回。

**小结**：Chat Ability 提供了参与者模型、消息树、上下文组装、触发路由、intent 生命周期、事件系统——一套完整的多 agent 对话基础设施，但不包含任何业务逻辑。

---

## 4. 第二层 A：Codoc Use

> 代码位置：`apps/cobook/src/codoc-use/`
>
> Codoc Use 将 @codoc/core 的能力翻译为 Chat Ability 的原语。它回答一个问题：**codoc 在 chat 中如何被引用、被理解、被操作、被感知。**

### 4.1 引用 — codoc 如何被 reference（`codoc-use/resource.ts`）

```typescript
function listCodocResources(workspace): ResourceRef[] {
  return workspace.listDocs().map(meta => ({
    kind: "codoc",
    id: meta.id,
    label: meta.name ?? meta.id,
  }));
}
```

把 workspace 的文档列表映射为 Chat Ability 的 `ResourceRef`。用户在左栏点击一个 codoc，就是在 session 中添加一个 `{ kind: "codoc", id: "report.codoc" }` 的资源引用。

### 4.2 理解 — codoc 如何被 agent 读取（`codoc-use/context.ts`）

```typescript
function createCodocContextSource(workspace, docId): ContextSource {
  return {
    kind: "codoc-snapshot",
    async resolve() {
      const runtime = await workspace.loadDoc(docId);
      return {
        kind: "codoc-snapshot",
        content: serializeCodocForLLM(meta, runtime),  // schema + 当前字段值
        tokens: estimateTokens(...),
      };
    },
  };
}
```

把 codoc 的 schema 和当前值序列化为 markdown 文本，注册为 `ContextSource`。任何 agent 如果在 `contextRequirements` 中声明了 `{ sourceKind: "codoc-snapshot" }`，上下文组装器就会自动 resolve 这些源并注入 prompt。

`createCodocContextSourceFactory()` 创建按需工厂——当用户 reference 了某个 codoc，工厂自动为它创建 ContextSource。

### 4.3 操作 — codoc 如何通过 intent 被修改（`codoc-use/intent.ts`）

定义四种 codoc 相关的 intent 类型：

```typescript
type CodocIntentKind =
  | "write-codoc-field"     // 写入字段值
  | "create-codoc"          // 创建新文档
  | "delete-codoc"          // 删除文档
  | "force-codoc-field"     // 强制重新计算字段
```

`executeCodocIntent()` 在 intent 被 confirmed 后执行实际操作：

```typescript
// "write-codoc-field" →
tree.updateField(field, value);
propagateAndInvalidate(dag, tree, [field]);
// 观察所有被标脏的下游字段，触发重新求值
```

Codoc Use 提供写入能力但**不做权限控制**——谁有权发起/确认 intent 是 agent 层和 UI 层的事。

### 4.4 感知 — codoc 变更如何进入 chat（`codoc-use/events.ts`）

```typescript
function bridgeWorkspaceEvents(workspace, chat, sessionId) {
  workspace.onFieldChange((event) => {
    // 防抖 2000ms，合并同一文档的多个字段变更
    // → 发送系统消息到 chat：
    //   "report.codoc 的字段 /revenue 已变更。
    //    下游 dashboard.codoc 的 /total 已标记为 stale。"
  });
}
```

workspace 的字段变更事件被翻译为 chat 系统消息。这些消息进入 Chat Bus，daemon agent（如 codoc-agent）可以检测到并主动响应（比如建议 re-force stale 字段）。

### 4.5 一次性初始化（`codoc-use/index.ts`）

```typescript
function initCodocUse(workspace, chat, sessionId) {
  // 1. 注册 codoc-snapshot ContextSourceFactory
  // 2. 监听 onIntentStatusChange → confirmed 时执行 intent
  // 3. 桥接 workspace 变更事件 → chat 系统消息
  return unsubscribe;  // 清理函数
}
```

一次调用注入全部 codoc 适配能力。Chat Ability 不需要任何修改。

**小结**：Codoc Use 是一个纯适配层。它不定义 agent，不渲染 UI，不管理 session。它只保证 codoc 能被 reference、能被读取为上下文、能通过 intent 被写入、变更能被感知。

---

## 5. 第二层 B：Agents

> 代码位置：`apps/cobook/src/agents/`
>
> Agents 和 Codoc Use 是同层但独立的两个关注点。Agents 定义"chat 中有哪些参与者，各自怎么工作"。它消费 Chat Ability 的原语和 Codoc Use 提供的上下文/intent 类型，但不直接操作 core。

### 5.1 AgentExecutor 模型（`agents/types.ts`）

```typescript
interface AgentExecutor {
  execute(context: ContextData[], triggerMessage: Message): Promise<ResponseAction | null>;
}
```

Agent 被触发后的流程：

```
触发消息 → Chat Ability 组装上下文 → AgentExecutor.execute() → 返回 ResponseAction
```

`createLLMAgentHandler()` 是通用的 LLM agent 工厂：
1. 将上下文格式化为 `[kind]\ncontent` 文本
2. 将触发消息格式化为 user prompt
3. 调用 Anthropic API（带 system prompt）
4. 从回复中解析 `<intent>...</intent>` 块为结构化 Intent
5. 返回 reply 消息（正文 + intents）

### 5.2 四个预置 Agent

#### codoc-agent（`agents/codoc-agent.ts`）

```
职责：codoc 的增删改查（唯一与写操作直接相关的 agent）
模式：daemon — 持续监听，自主响应
触发条件：消息中包含 codoc resource ref，或包含 codoc intent
上下文：required codoc-snapshot，optional chat-history (1000 tokens)
```

- 响应用户的 codoc 操作请求（"帮我更新这个字段"）
- 监听其他 agent 产出的 write intent，提议执行
- 响应 stale 通知，建议 re-force

#### summary-agent（`agents/summary-agent.ts`）

```
职责：结构化总结（对话 / codoc / 混合）
模式：on-mention — 被 @mention 时才工作
上下文：required chat-history，optional quoted-messages + codoc-snapshot
```

- 不带 codoc reference → 总结当前对话
- 带 codoc reference → 结合对话和 codoc 总结
- 如果总结需要写入 codoc，产出 write intent 而不自己写入

#### info-check-agent（`agents/info-check-agent.ts`）

```
职责：校验 codoc 字段的一致性、时效性、引用有效性
模式：on-mention
上下文：required codoc-snapshot，optional chat-history (500 tokens)
```

- 输出校验报告
- 如果发现需要修正的字段，产出 write intent

#### polish-agent（`agents/polish-agent.ts`）

```
职责：润色 codoc 文本字段
模式：on-mention
上下文：required codoc-snapshot
```

- 逐字段产出 write intent，用户逐个确认

### 5.3 Agent 间的协作模式

Agent 之间**不直接调用彼此**，通过 Intent 解耦：

```
summary-agent 产出消息（可能带 write intent, status: proposed）
  ↓
codoc-agent（daemon 模式）检测到 write intent
  ↓
codoc-agent 回复："要把总结写入 report.codoc 的 /summary 字段吗？"
  ↓
用户点击 Confirm → intent 变为 confirmed
  ↓
Codoc Use 的 intent 执行器 → workspace.updateField()
```

关键点：
- summary-agent 不需要知道 codoc-agent 的存在，只需要知道 `write-codoc-field` 这个 intent 类型
- codoc-agent 不需要知道是哪个 agent 产出了 intent
- 解耦通过 intent 类型实现

### 5.4 注册（`agents/register.ts`）

```typescript
function registerPresetAgents(chat, sessionId) {
  // 注册 4 个 Participant 声明
}

function registerPresetAgentHandlers(chat, sessionId) {
  // 绑定 4 个 AgentExecutor（system prompt + LLM 调用）
}
```

注册分两步：参与者声明（who they are）和执行器绑定（how they work）。这让声明和实现分离，便于测试。

**小结**：Agents 层定义了对话中的专业角色。每个 agent 有明确的能力边界、上下文需求、响应模式。它们通过 intent 间接协作，不直接操作 core。

---

## 6. 第三层：Workspace

> 代码位置：`apps/cobook/src/workspace/` + `apps/cobook/src/app/`
>
> Workspace 是最终的组装层。它把前面的所有层粘合在一起，加上 UI 和 app 生命周期管理。

### 6.1 服务端：启动与单例

**workspace 单例**（`workspace/api/_workspace.ts`）：

```typescript
let workspace: Workspace;
function getWorkspace() {
  if (!workspace) {
    ensureLLMClient();  // 注入 Anthropic client 到 core
    workspace = await Workspace.create(docsDir);
  }
  return workspace;
}
```

**chat 单例**（`workspace/api/_chat.ts`）：

```typescript
function initChat() {
  const workspace = await getWorkspace();
  const chat = createChatAbility();
  const session = chat.createSession({ name: "main" });

  // 注入 codoc 适配能力
  initCodocUse(workspace, chat, sessionId);

  // 注册 agent
  registerPresetAgents(chat, sessionId);
  registerPresetAgentHandlers(chat, sessionId);

  return { chat, sessionId };
}
```

这就是设计文档中描述的 5 步启动流程：

```
1. 加载 workspace（core）
2. 创建 ChatAbility + Session（chat 层）
3. initCodocUse — 注入 codoc 适配（codoc-use 层）
4. registerPresetAgents — 注入参与者（agents 层）
5. 渲染 UI（workspace 层）
```

### 6.2 API 路由

所有路由位于 `apps/cobook/src/app/api/`。路由文件是 Next.js 约定位置，逻辑实现在 `workspace/api/` 中。

| 路由 | 方法 | 作用 |
|------|------|------|
| `/api/workspace` | GET | 返回 WorkspaceSnapshot（文档列表 + 依赖图） |
| `/api/docs` | POST | 创建新 .codoc 文件 |
| `/api/docs/[docId]` | GET | 返回单个文档快照（字段状态 + 值 + view） |
| `/api/docs/[docId]/field` | POST | 字段操作：update 或 reforce |
| `/api/docs/[docId]/force` | POST | 批量重新计算文档所有字段 |
| `/api/chat` | GET/POST | GET 返回当前消息+参与者+引用；POST 发送消息 |
| `/api/chat/intent` | POST | 更新 intent 状态（confirm/reject） |
| `/api/chat/reference` | POST/DELETE | 添加/移除 session 中的资源引用 |
| `/api/events` | GET | SSE 端点，推送字段变更 + chat 消息 + intent 变更事件 |

### 6.3 客户端状态管理

**两个 Store**（均使用 `useSyncExternalStore` 接入 React，不引入额外框架）：

`WorkspaceStore`（`workspace/workspace-store.ts`）— 管理文档数据：
- docs 元数据、依赖图、字段快照、view 模板
- 字段事件 feed（最近 200 条，保留最新 100 条）
- `applyFieldEvent()` 实时更新字段状态

`ChatSessionStore`（`workspace/hooks/use-session.ts`）— 管理聊天数据：
- messages、participants、references
- `addMessage()`、`updateIntentStatus()`、`addReference()` / `removeReference()`

**Hooks**：
- `useWorkspaceInit()` — 首次加载 workspace + 聊天状态，启动 SSE 连接
- `useWorkspaceDocs()` / `useWorkspaceGraph()` — 订阅 workspace 数据
- `useChatMessages()` / `useChatParticipants()` / `useChatReferences()` — 订阅聊天数据
- `useFieldSnapshot(docId, path)` — 订阅特定字段

**SSE 连接**（在 `useWorkspaceInit` 中建立）：
- 连接 `/api/events`
- 监听 `field` / `chat-message` / `chat-intent` 事件
- 实时更新 WorkspaceStore 和 ChatSessionStore
- 断线自动重连（2 秒延迟）

### 6.4 UI 组件

```
<WorkspaceShell>                              // 三栏布局
  ├── <CodocList>                             // 左栏：资源列表
  │   └── 搜索 + codoc 条目（点击 toggle reference）
  │
  ├── 中间区域（可切换 chat / graph 视图）
  │   ├── <ChatArea>                          // 对话视图
  │   │   ├── <ContextBar>                    // 当前 active references 徽章
  │   │   ├── <MessageRow> × N               // 消息列表
  │   │   │   ├── Avatar + 发送者名 + 时间
  │   │   │   ├── 消息正文
  │   │   │   ├── <IntentCard> × N           // intent 操作卡片
  │   │   │   └── <CodocCard> × N            // codoc 引用卡片
  │   │   └── <ChatInput>                    // 输入框（@mention + /command）
  │   │
  │   └── <DagGraphView>                     // 图谱视图（SVG 依赖图）
  │
  └── <AgentsPanel>                          // 右栏：agent 列表
      └── agent 卡片 × 4（名称 + 描述 + daemon 标记）
```

关键 UI 细节：

- **MessageRow**：每个 agent 有独特的颜色标识（blue/violet/amber/emerald），用户一眼能区分消息来源
- **IntentCard**：proposed 状态显示蓝色 + Confirm/Reject 按钮；confirmed 显示绿色；rejected 显示红色。包含预览值。
- **ChatInput**：输入 `@` 弹出 mention 下拉（participants + resources），支持键盘导航
- **CodocCard**：可展开的文档详情卡，显示字段状态（resolved/pending/error/dirty/idle 对应不同颜色的状态点）
- **DagGraphView**：分层布局算法渲染 SVG 依赖图，节点可点击 toggle reference，hover 高亮关联路径

---

## 7. 运行时数据流

### 场景：用户请求 summary-agent 总结讨论并写入 codoc

```
(1) 用户在左栏点击 "report.codoc"
    │
    ├→ POST /api/chat/reference  { kind: "codoc", id: "report.codoc" }
    │   └→ chat.addResourceRef() → 触发 ContextSourceFactory
    │       → 自动创建 codoc-snapshot ContextSource
    │
    └→ SSE → ChatSessionStore.addReference() → ContextBar 显示徽章

(2) 用户输入 "@summary-agent 总结一下讨论要点"
    │
    ├→ POST /api/chat  { content: "...", mentionedParticipants: ["summary-agent"] }
    │   └→ chat.sendMessage() → 消息进入 Chat Bus
    │
    ├→ Chat Bus 路由：
    │   ├→ summary-agent：mentionedParticipants 包含自己 → 触发
    │   └→ codoc-agent (daemon)：消息无 codoc intent/resource → 跳过
    │
    └→ SSE → ChatSessionStore.addMessage() → MessageRow 渲染用户消息

(3) summary-agent 被触发
    │
    ├→ assembleContext()：
    │   ├→ chat-history (required) → resolve → 历史消息文本
    │   └→ codoc-snapshot (optional) → resolve → report.codoc schema+值
    │
    ├→ createLLMAgentHandler() 调用 Anthropic API：
    │   ├→ system prompt: "你是 Summary，负责结构化总结..."
    │   ├→ user prompt: [上下文] + [触发消息]
    │   └→ API 回复: "总结如下：...\n<intent>{\"kind\":\"write-codoc-field\",...}</intent>"
    │
    ├→ 解析 intent 块 → 构造 ResponseAction
    │   └→ { type: "reply", message: { content: "总结如下：...", intents: [{ kind: "write-codoc-field", status: "proposed", payload: { docId: "report.codoc", field: "/summary", value: "..." } }] } }
    │
    └→ 回复消息进入 Chat Bus → SSE 推送
        └→ MessageRow 渲染 summary-agent 的回复 + IntentCard

(4) codoc-agent (daemon) 被响应链触发
    │
    ├→ TriggerFilter 检查：消息含 intentKinds: ["write-codoc-field"] → 匹配
    │
    ├→ assembleContext() + LLM 调用
    │   └→ 回复: "要把总结写入 report.codoc 的 /summary 字段吗？"
    │
    └→ SSE → MessageRow 渲染 codoc-agent 的确认提议

(5) 用户点击 IntentCard 上的 "Confirm"
    │
    ├→ POST /api/chat/intent  { msgId, intentIdx, status: "confirmed" }
    │   └→ chat.updateIntentStatus()
    │       └→ 触发 onIntentStatusChange 事件
    │
    ├→ Codoc Use 监听到 confirmed intent
    │   └→ executeCodocIntent():
    │       ├→ tree.updateField("/summary", "...")
    │       ├→ propagateAndInvalidate(dag, tree, ["/summary"])
    │       └→ 观察所有被标脏的下游字段
    │
    ├→ Workspace.onFieldChange 触发
    │   ├→ bridgeWorkspaceEvents → chat 系统消息: "report.codoc /summary 已变更"
    │   └→ 如果有跨文档下游 → "dashboard.codoc /total 已标记为 stale"
    │
    └→ SSE → UI 更新：
        ├→ IntentCard 状态变为 confirmed（绿色）
        ├→ MessageRow 显示系统消息（字段变更通知）
        └→ CodocCard 中字段值更新
```

---

## 8. 目录结构速查

```
apps/cobook/src/
│
├── chat/                            # Chat Ability — 通用对话能力层
│   ├── types.ts                     #   类型：Message, Participant, Intent, ResourceRef, ResponseMode...
│   ├── session.ts                   #   Session, MessageTree, 分支操作
│   ├── context.ts                   #   ContextSource, ContextRequirement, assembleContext()
│   ├── bus.ts                       #   ChatBus, 消息路由, TriggerFilter 匹配, 防循环
│   ├── events.ts                    #   SessionEventEmitter (per session)
│   ├── index.ts                     #   createChatAbility() → ChatAbility 接口
│   └── __tests__/
│
├── codoc-use/                       # Codoc Use — core 适配层
│   ├── types.ts                     #   CodocIntentKind, payload 类型, isCodocIntent()
│   ├── resource.ts                  #   listCodocResources() → ResourceRef[]
│   ├── context.ts                   #   createCodocContextSource(), serializeCodocForLLM()
│   ├── intent.ts                    #   executeCodocIntent() — confirmed intent 执行
│   ├── events.ts                    #   bridgeWorkspaceEvents() — workspace→chat 事件桥接
│   ├── index.ts                     #   initCodocUse() 一次性注入 + isFieldStale()
│   └── __tests__/
│
├── agents/                          # Agents — 参与者定义 + 执行器
│   ├── types.ts                     #   AgentExecutor, createLLMAgentHandler(), intent 解析
│   ├── codoc-agent.ts               #   daemon agent — codoc CRUD
│   ├── summary-agent.ts             #   on-mention — 结构化总结
│   ├── info-check-agent.ts          #   on-mention — 校验一致性
│   ├── polish-agent.ts              #   on-mention — 文本润色
│   ├── register.ts                  #   registerPresetAgents() + registerPresetAgentHandlers()
│   ├── index.ts                     #   re-exports
│   └── __tests__/
│
├── workspace/                       # Workspace — 应用容器
│   ├── workspace-store.ts           #   WorkspaceStore (客户端状态：docs, graph, fields)
│   ├── api-client.ts                #   HTTP 客户端 (fetch workspace/docs/chat)
│   ├── hooks/
│   │   ├── use-session.ts           #   ChatSessionStore + useChatMessages/Participants/References
│   │   ├── use-workspace.ts         #   useWorkspaceInit() + SSE + useWorkspaceDocs/Graph
│   │   └── use-field-snapshot.ts    #   useFieldSnapshot(docId, path)
│   ├── api/
│   │   ├── _workspace.ts            #   服务端 workspace 单例
│   │   └── _chat.ts                 #   服务端 chat 单例 (initChat: 5 步启动)
│   └── components/
│       ├── WorkspaceShell.tsx        #   三栏布局壳
│       ├── ChatArea.tsx              #   消息流 + 空状态
│       ├── ChatInput.tsx             #   输入框 + @mention 下拉
│       ├── MessageRow.tsx            #   单条消息（avatar + 内容 + intent/resource 卡片）
│       ├── IntentCard.tsx            #   intent 操作卡片（confirm/reject）
│       ├── ContextBar.tsx            #   active references 徽章栏
│       ├── CodocList.tsx             #   左栏资源列表 + 搜索
│       ├── CodocCard.tsx             #   可展开的 codoc 详情卡
│       ├── AgentsPanel.tsx           #   右栏 agent 列表
│       ├── DagGraphView.tsx          #   SVG 依赖图（分层布局）
│       ├── CodataValue.tsx           #   MDX 内嵌字段值展示
│       └── mdx-components.tsx        #   MDX 组件注册表
│
├── shared/                          # 跨领域共享
│   ├── types.ts                     #   HTTP 契约类型 (FieldSnapshot, DocSnapshot, etc.)
│   ├── ai.ts                        #   Anthropic client 懒初始化
│   └── utils.ts                     #   cn() (clsx + twMerge)
│
└── app/                             # Next.js app shell
    ├── layout.tsx                   #   根布局 (Geist 字体 + TooltipProvider)
    ├── page.tsx                     #   单页：<WorkspaceShell />
    └── api/                         #   API 路由（薄转发，逻辑在 workspace/api/）
        ├── workspace/route.ts
        ├── docs/route.ts
        ├── docs/[docId]/route.ts
        ├── docs/[docId]/field/route.ts
        ├── docs/[docId]/force/route.ts
        ├── chat/route.ts
        ├── chat/intent/route.ts
        ├── chat/reference/route.ts
        └── events/route.ts
```

---

**核心设计模式回顾**：

| 模式 | 体现 |
|------|------|
| 分层解耦 | Chat → Codoc Use → Agents → Workspace，每层只依赖相邻下层 |
| Intent 生命周期 | proposed → confirmed/rejected → 执行，通用的"先预览再操作" |
| 上下文按需组装 | agent 声明需求，系统从可用源中匹配、resolve、裁剪 |
| 事件驱动 | 内部 EventEmitter + SSE 推送，状态变更自动传播到 UI |
| 消息路由 | Bus 模式，on-mention 精确匹配 / daemon 规则过滤 + 防循环 |
| Fire-and-forget | sendMessage 立即返回，agent 路由异步进行 |
| 外部 Store + useSyncExternalStore | 状态在各自的层中，React 只做投影 |
