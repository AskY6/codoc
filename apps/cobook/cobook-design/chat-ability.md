# Chat Ability 设计

Chat Ability 是一个可复用的多参与者对话能力层。它不知道 codoc 的存在，不知道自己被用在知识管理场景。它只提供：参与者模型、消息模型、上下文管理原语、触发与响应机制。

任何需要"人 + 多个 AI agent 协作"的应用都可以复用这一层。

---

## 一、核心概念

### 1.1 Participant（参与者）

Chat 中的参与者不是"用户"和"助手"两种角色，而是具名的、有能力边界的实体。

```typescript
interface Participant {
  id: string;
  kind: "human" | "agent";
  name: string;
  description: string;

  /** Agent 声明自己需要什么上下文才能工作 */
  contextRequirements?: ContextRequirement[];

  /** Agent 的响应模式 */
  responseMode: ResponseMode;
}
```

**Human participant** 只有一个（当前用户）。

**Agent participant** 可以有多个，每个有明确的职责描述。Agent 不是万能的助手，是能力边界清晰的专业参与者。

### 1.2 Message（消息）

```typescript
interface Message {
  id: string;
  /** 发送者 */
  sender: ParticipantRef;
  /** 消息内容 */
  content: string;
  /** 消息引用的其他消息 */
  quotedIds?: string[];
  /** 消息提及的资源（抽象的，不限于 codoc） */
  resourceRefs?: ResourceRef[];
  /** 消息提及的参与者（@agent） */
  mentionedParticipants?: string[];
  /** 消息附带的结构化 intent（agent 可在消息中声明意图） */
  intents?: Intent[];
  /** 时间戳 */
  timestamp: number;
}
```

消息是 chat 的原子单位。关键设计决策：

- **消息不只有文本**。消息可以携带 `resourceRefs`（对外部资源的引用）和 `intents`（结构化的行动意图）。这两个字段是 Chat Ability 与外部世界交互的接口。
- **引用是一等公民**。`quotedIds` 让消息能引用之前的消息，形成非线性的对话结构。
- **mention 是触发机制**。`mentionedParticipants` 是显式触发 agent 的方式。

### 1.3 Resource（资源）

Chat 内部不定义具体的资源类型，但提供资源引用的抽象：

```typescript
interface ResourceRef {
  kind: string;     // 由应用层定义，如 "codoc"、"code-snippet"、"url"
  id: string;       // 资源标识
  label?: string;   // 显示名称
}
```

Chat Ability 对资源做的事情很少——它只负责把 `ResourceRef` 传递给参与者，让参与者自己决定怎么使用。资源的加载、渲染、操作都是应用层的事。

### 1.4 Intent（意图）

Agent 在回复中可以声明结构化的行动意图：

```typescript
interface Intent {
  kind: string;         // 由应用层定义，如 "write-codoc-field"、"request-review"
  payload: unknown;     // 意图的具体参数
  status: "proposed" | "confirmed" | "rejected";
}
```

Intent 的生命周期：
1. Agent 产出一条消息，其中包含 `intents`（状态为 `proposed`）
2. Human 或其他 agent 可以 confirm/reject 这些 intent
3. 应用层监听 intent 状态变更，执行实际操作

Intent 是 Chat Ability 与应用层的关键桥梁。Chat 不知道 "write-codoc-field" 意味着什么，但它管理 intent 的提议-确认-执行流程。这把"先预览再写入"的交互模式从 codoc 特定逻辑提升为通用 chat 原语。

### 1.5 Thread（子线程）

Thread 是 Chat Ability 的嵌套结构原语。一条消息可以生出一个子 thread，子 thread 本身是一个完整的 chat 环境——有自己的参与者、上下文、消息流，同时能向父 chat 查询上下文和推送更新。

```typescript
interface ThreadAnchor {
  /** 父 session 中哪条消息触发了这个 thread */
  parentMessageId: string;
  /** thread 的生命周期状态 */
  status: "open" | "resolved" | "abandoned";
  /** thread 结束时的总结（surface 到父 chat） */
  resolution?: {
    summary: string;
    intents?: Intent[];
  };
}
```

**Thread vs. Branch 的区别：**

| | Branch（分叉） | Thread（嵌套） |
|--|----------------|----------------|
| 方向 | 水平——同层的替代路径 | 垂直——深入某个话题 |
| 上下文 | 共享父 session 的所有状态 | 独立 session，按需继承父上下文 |
| 参与者 | 同一批 participants | 可以是不同的 participant 子集 |
| 结果 | 不回到原路径 | resolve 后结论 surface 回父 chat |
| 类比 | git branch | 函数调用（有自己的栈帧，能读外层作用域，能 return） |

Branch 是"换个方向试试"。Thread 是"就这个话题深入聊，聊完把结论带回来"。

**ThreadLink（父子通信协议）：**

```typescript
interface ThreadLink {
  /** 子 thread 所属的父 session */
  parentSessionId: string;
  /** 锚定信息 */
  anchor: ThreadAnchor;

  /** 向上查询：读取父 session 的上下文 */
  queryParentContext(sourceKind: string): Promise<ContextData>;
  /** 向上查询：读取父 session 的消息 */
  getParentMessages(options?: { limit?: number; fromMessageId?: string }): Message[];
  /** 向上查询：读取父 session 的 active resources */
  getParentResources(): ResourceRef[];

  /** 向上推送：向父 session 发一条消息（出现在 anchor message 之后） */
  postToParent(msg: Omit<Message, "id" | "timestamp">): Message;
  /** 结束 thread：将结论 surface 到父 chat */
  resolve(resolution: { summary: string; intents?: Intent[] }): void;
  /** 放弃 thread */
  abandon(): void;
}
```

通信是双向但**非对称**的：
- **子 → 父（query）**：子 thread 可以随时读父的上下文和消息，像闭包读外层变量。这是只读的。
- **子 → 父（update）**：`postToParent` 是过程中的推送，`resolve` 是结论性的推送。
- **父 → 子**：父 chat 不直接向子 thread 发消息。父的状态变化通过子 thread 的 `queryParentContext` 按需感知（pull 模式，不是 push）。

---

## 二、上下文管理

### 2.1 Context Source（上下文源）

上下文不是一坨塞进 system prompt 的文本，而是可枚举、可组装的结构化信息源：

```typescript
interface ContextSource {
  kind: string;                    // "chat-history" | "resource-snapshot" | "quoted-messages" | ...
  resolve(): Promise<ContextData>; // 惰性解析，按需加载
}

interface ContextData {
  kind: string;
  content: string;   // 序列化后的文本表示，用于注入 LLM prompt
  tokens?: number;   // 预估 token 数，用于预算管理
}
```

Chat Ability 内置的上下文源：

| kind | 说明 |
|------|------|
| `chat-history` | 当前分支的对话历史 |
| `quoted-messages` | 被引用的消息 |
| `participant-outputs` | 特定参与者在当前 session 中的所有输出 |

应用层可以注册额外的上下文源（如 `codoc-snapshot`），Chat Ability 不需要知道它们的细节。

### 2.2 Context Requirement（上下文需求）

每个 agent 声明自己需要什么上下文：

```typescript
interface ContextRequirement {
  sourceKind: string;       // 需要哪种上下文源
  priority: "required" | "optional";
  maxTokens?: number;       // 对这个源的 token 预算
}
```

例如：
- summary-agent 声明需要 `chat-history`（required）+ 应用层注册的上下文源（optional）
- codoc-agent 声明需要应用层注册的上下文源（required），不太需要 `chat-history`

### 2.3 Context Assembly（上下文组装）

当一个 agent 被触发响应时，Chat Ability 执行上下文组装：

1. 读取该 agent 的 `contextRequirements`
2. 从可用的 `ContextSource` 中匹配 required 和 optional 的源
3. 按优先级 resolve 各个源，组装成最终的 context
4. 如果总 token 超预算，按优先级裁剪 optional 的部分

组装结果交给 agent 的 LLM 调用层。Chat Ability 负责组装，不负责调用 LLM。

### 2.4 Context Inheritance（上下文继承）

子 thread 是独立的 Session，但可以按需继承父 session 的上下文。继承策略在创建 thread 时声明：

```typescript
interface ThreadConfig {
  /** 继承哪些参与者。true=全部，string[]=指定 ID，false=不继承 */
  inheritParticipants: boolean | string[];
  /** 继承哪些上下文源。true=全部，string[]=按 kind 指定，false=不继承 */
  inheritContext: boolean | string[];
  /** 子 thread 自己额外注册的参与者 */
  additionalParticipants?: Participant[];
  /** 子 thread 自己额外注册的上下文源 */
  additionalContextSources?: ContextSource[];
}
```

继承不是复制。子 thread 通过 `ThreadLink.queryParentContext()` 按需读取父上下文，父上下文的变化对子 thread 是实时可见的。

子 thread 还自动获得一个内置的上下文源：

| kind | 说明 |
|------|------|
| `parent-context` | 通过 ThreadLink 读取的父 session 上下文（按需 resolve） |
| `parent-messages` | 父 session 中 anchor message 及其之前的消息历史 |

这意味着子 thread 中的 agent 如果声明了 `contextRequirements: [{ sourceKind: "parent-context", priority: "optional" }]`，上下文组装器会自动通过 ThreadLink 查询父 session。Agent 不需要知道自己在根 session 还是子 thread 中——上下文源的抽象屏蔽了这个差异。

---

## 三、触发与响应机制

### 3.1 ResponseMode（响应模式）

```typescript
type ResponseMode =
  | { type: "on-mention" }        // 只在被 @mention 时响应
  | { type: "on-command"; commandId: string }  // 只在 /command 时响应
  | { type: "daemon"; filter: TriggerFilter }  // 持续监听，自主判断是否响应
  | { type: "passive" }           // 从不主动响应，只能被其他 agent 调用
```

### 3.1.1 响应动作

Agent 被触发后，可以执行两种响应动作：

```typescript
type ResponseAction =
  | { type: "reply"; message: Omit<Message, "id" | "timestamp"> }
  | { type: "open-thread"; config: ThreadConfig; firstMessage?: Omit<Message, "id" | "timestamp"> }
```

- **reply**：在当前 session 中发一条消息（现有行为）
- **open-thread**：在触发消息上开启子 thread，并可选发出第一条消息。子 thread 是完整的 Session，agent 在其中持续工作直到 resolve 或 abandon。

Agent 自主决定用哪种动作。简单请求 → reply。复杂任务需要多步工作 → open-thread。

### 3.2 TriggerFilter（触发过滤）

Daemon 模式下，agent 不是对每条消息都调用 LLM 判断。触发分两层：

**第一层：规则过滤（零成本）**

```typescript
interface TriggerFilter {
  /** 只关注特定发送者的消息 */
  fromParticipants?: string[];
  /** 只关注包含特定资源类型的消息 */
  resourceKinds?: string[];
  /** 只关注包含特定 intent 类型的消息 */
  intentKinds?: string[];
  /** 关键词匹配 */
  keywords?: string[];
}
```

规则过滤是快速的 if/else，不涉及 LLM。大多数消息在这一层就被过滤掉。

**第二层：LLM 判断（按需）**

通过规则过滤的消息，agent 可以用一次轻量 LLM 调用（或本地分类器）判断是否值得响应。这一层是可选的——如果规则过滤已经足够精确，可以跳过。

### 3.3 消息路由

消息在 chat 中的流转逻辑：

```
Message 进入 Chat Bus（当前 Session 作用域）
  │
  ├─→ 所有 on-mention agent：检查 mentionedParticipants 是否包含自己
  │     └─→ 匹配 → 触发响应（reply 或 open-thread）
  │
  ├─→ 所有 daemon agent：过第一层 TriggerFilter
  │     └─→ 通过 → 过第二层 LLM 判断（可选）
  │           └─→ 通过 → 触发响应（reply 或 open-thread）
  │
  └─→ 所有 passive agent：不处理
```

**作用域规则：** 消息路由在当前 Session 内进行，不穿透到子 thread 或父 session。
- 父 chat 的消息只触发父 chat 中的 agent
- 子 thread 的消息只触发子 thread 中的 agent
- 子 thread 向父 chat 的通信通过 `ThreadLink.postToParent()` 显式进行，post 出的消息进入父 chat 的 Bus，可触发父 chat 的 agent

响应的产出是一条新的 Message 或一个新的 Thread。Message 进入同一个 Chat Bus，可能触发其他 agent。Thread 创建新的 Session 作用域。

### 3.4 响应链与防循环

Agent A 的输出可能触发 Agent B，B 的输出可能触发 Agent C。这是"群聊"的正常行为，但需要防止无限循环：

- **深度限制**：一条用户消息触发的响应链最多 N 层（可配置，默认 3）
- **去重**：同一个 agent 对同一条触发消息只响应一次
- **冷却**：daemon 模式的 agent 在响应后有短暂冷却期，避免高频触发

---

## 四、会话模型

### 4.1 Session（会话）

Session 是递归结构。每个 Session 是一个完整的 chat 环境，可以嵌套子 thread。

```typescript
interface Session {
  id: string;
  /** 参与者列表（session 创建时确定，可动态增减） */
  participants: Participant[];
  /** 注册的上下文源 */
  contextSources: ContextSource[];
  /** 消息树（支持分支） */
  messageTree: MessageTree;

  /** 父 session 的链接（根 session 为 undefined） */
  threadLink?: ThreadLink;
  /** 子 threads：messageId → child Session */
  threads: Map<string, Session>;
}
```

**根 Session** 没有 `threadLink`，是对话的最外层容器。

**子 Session（Thread）** 有 `threadLink`，锚定在父 session 的某条消息上。子 Session 本身也可以再开子 thread，形成任意深度的嵌套。

Session 的递归性意味着 Chat Ability 的所有能力——消息路由、上下文组装、分支、事件——在每一层 thread 中都完整可用。

### 4.2 MessageTree（消息树）

消息不是线性列表，是树状结构，支持分支：

```typescript
interface MessageNode {
  message: Message;
  parentId: string | null;
  childIds: string[];
  /** 这条消息上挂载的子 thread（如果有） */
  threadId?: string;
}
```

- 每条消息有一个 parent（根消息的 parent 为 null）
- 一条消息可以有多个 children（分支点）
- 一条消息可以有一个挂载的 thread（通过 `threadId` 关联到 `session.threads`）
- "当前对话"是从根到某个叶子节点的路径（active branch）

**Branch vs. Thread 在 MessageTree 中的体现：**

```
MessageNode A
  ├── child B (branch: 同层替代路径)
  ├── child C (branch: 另一条替代路径)
  └── threadId → Session X (thread: 垂直嵌套，独立 Session)
```

Branch 是 MessageTree 内部的结构（多个 childIds）。Thread 是跨 Session 的结构（指向一个子 Session）。

### 4.3 Thread 生命周期

```
创建 (open)
  │  由用户手动发起，或 agent 的 ResponseAction 发起
  │  指定 ThreadConfig（继承策略）
  │  在 anchor message 的 MessageNode 上记录 threadId
  │  创建子 Session，注入继承的 participants 和 context
  │
  ├─→ 活跃 (open)
  │     子 thread 中正常进行对话
  │     可通过 ThreadLink 查询父上下文
  │     可通过 postToParent 向父 chat 推送消息
  │     可在子 thread 中继续开嵌套 thread
  │
  ├─→ 结束 (resolved)
  │     调用 ThreadLink.resolve()
  │     resolution.summary 作为一条消息出现在父 chat 的 anchor message 之后
  │     resolution.intents 进入父 chat 的 intent 生命周期
  │     子 Session 变为只读（可查看历史，不可追加消息）
  │
  └─→ 放弃 (abandoned)
        调用 ThreadLink.abandon()
        父 chat 中标记 "thread abandoned"
        子 Session 变为只读
```

### 4.4 嵌套深度与约束

Thread 可以无限嵌套（thread 中再开 thread），但需要实际约束：

- **最大嵌套深度**：可配置，默认 5。超过后禁止再开子 thread。
- **总活跃 thread 数限制**：一个根 Session 下最多 N 个活跃 thread（包括所有层级），默认 20。
- **单消息单 thread**：一条消息最多挂载一个 thread。如果需要多个子任务，agent 应该先 reply 多条消息，再分别开 thread。

### 4.5 事件

Chat Ability 对外暴露的事件。事件以 Session 为作用域——订阅某个 Session 的事件只收到该 Session 内的变化，不穿透到子 thread。

```typescript
interface ChatEvents {
  /** 当前 session 中的新消息 */
  onMessage: (msg: Message) => void;
  /** intent 状态变更 */
  onIntentStatusChange: (msgId: string, intentIdx: number, status: Intent["status"]) => void;
  /** 分支切换 */
  onBranchSwitch: (activePath: string[]) => void;
  /** 参与者变更 */
  onParticipantJoin: (participant: Participant) => void;
  onParticipantLeave: (participantId: string) => void;

  /** 子 thread 被创建 */
  onThreadOpen: (parentMessageId: string, childSession: Session) => void;
  /** 子 thread 被 resolve，结论 surface 到当前 session */
  onThreadResolve: (parentMessageId: string, resolution: { summary: string; intents?: Intent[] }) => void;
  /** 子 thread 被 abandon */
  onThreadAbandon: (parentMessageId: string) => void;
  /** 子 thread 向当前 session postToParent 了一条消息 */
  onThreadPost: (parentMessageId: string, msg: Message) => void;
}
```

应用层通过这些事件感知 chat 的状态变化，做出 UI 更新或业务操作。Thread 相关的事件让 UI 能够：展示"有子 thread"的标记、实时显示子 thread 的 postToParent 消息、在 resolve 时显示结论。

---

## 五、Chat Ability 的边界

Chat Ability **做**的事情：
- 管理参与者和消息
- 组装上下文（含跨 session 的继承上下文）
- 路由消息到参与者（Session 作用域内）
- 管理 intent 的生命周期（proposed → confirmed/rejected）
- 管理消息树（分支、切换）
- 管理 thread 的生命周期（open → resolved/abandoned）和父子通信
- 暴露事件（含 thread 相关事件）

Chat Ability **不做**的事情：
- 不调用 LLM（agent 的 LLM 调用是 agent 自己的实现细节，不是 chat 的能力）
- 不渲染 UI（UI 是应用层的事）
- 不知道任何具体资源类型（codoc、code snippet 等由应用层通过 ResourceRef 和 ContextSource 注入）
- 不执行 intent（intent 的实际执行由应用层监听 onIntentStatusChange 后自行处理）
- 不持久化（会话的存储是应用层的选择）

---

## 六、与应用层的集成接口

应用层通过以下方式接入 Chat Ability：

```typescript
interface ChatAbility {
  /** 创建根会话 */
  createSession(config: SessionConfig): Session;

  /** 注册参与者 */
  registerParticipant(sessionId: string, participant: Participant): void;

  /** 注册上下文源 */
  registerContextSource(sessionId: string, source: ContextSource): void;

  /** 注册上下文源工厂（按 ResourceRef 按需创建 ContextSource） */
  registerContextSourceFactory(sessionId: string, factory: { kind: string; create: (ref: ResourceRef) => ContextSource }): void;

  /** 获取消息中的 intent */
  getIntent(sessionId: string, msgId: string, intentIdx: number): Intent;

  /** 发送消息（人类或程序化发送） */
  sendMessage(sessionId: string, msg: Omit<Message, "id" | "timestamp">): Message;

  /** 更新 intent 状态 */
  updateIntentStatus(sessionId: string, msgId: string, intentIdx: number, status: Intent["status"]): void;

  /** 分支操作 */
  branchAt(sessionId: string, messageId: string): string;
  switchBranch(sessionId: string, leafMessageId: string): void;

  /** Thread 操作 */
  openThread(sessionId: string, anchorMessageId: string, config: ThreadConfig): Session;
  resolveThread(threadSessionId: string, resolution: { summary: string; intents?: Intent[] }): void;
  abandonThread(threadSessionId: string): void;
  getThread(sessionId: string, anchorMessageId: string): Session | undefined;

  /** 事件订阅（per session） */
  on<K extends keyof ChatEvents>(sessionId: string, event: K, handler: ChatEvents[K]): Unsubscribe;
}
```

应用层（如 Codoc Use）通过这个接口注册自己的 agent、上下文源和资源类型，不需要修改 Chat Ability 的内部实现。

**Thread 操作说明：**

- `openThread` 在指定消息上创建子 Session，返回完整的 Session 对象。后续可以对子 Session 使用所有 ChatAbility 方法（sendMessage、registerParticipant 等），因为它本身就是一个 Session。
- `resolveThread` 结束子 Session，resolution 的 summary 自动作为消息 post 到父 Session，intents 进入父 Session 的 intent 生命周期。
- `getThread` 查询某条消息上是否有子 thread。
- 事件订阅现在是 per-session 的（需要 `sessionId` 参数），订阅某个 session 的事件不会收到其子 thread 内部的事件，但会收到子 thread 的 `onThreadOpen/onThreadResolve/onThreadPost` 事件。
