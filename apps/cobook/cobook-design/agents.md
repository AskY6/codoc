# Agents 设计

Agents 是 chat 中的参与者定义。每个 agent 是一个具名的、有能力边界的专业参与者，有自己的 system prompt、上下文需求、响应模式和协作规则。

Agent 消费两层能力：
- **Chat Ability** — 参与者模型、消息收发、上下文组装、intent 机制
- **Codoc Use** — codoc-snapshot 上下文源、codoc intent 类型（agent 按需使用，不强制依赖）

Agent 不直接操作 CoDoc Core。对 codoc 的写入通过 intent 机制间接进行，由 Codoc Use 的 intent 执行器完成。

---

## 一、Agent 通用模型

### 1.1 Participant 接口

每个 agent 实现 Chat Ability 的 Participant 接口：

```typescript
interface Participant {
  id: string;
  kind: "agent";
  name: string;
  description: string;
  contextRequirements: ContextRequirement[];
  responseMode: ResponseMode;
}
```

此外，agent 还需提供自己的执行逻辑——接收组装好的上下文，产出消息（可能包含 intent）。

### 1.2 Agent 执行

Agent 被触发后的执行流程：

```
触发 → Chat Ability 组装上下文 → Agent 执行（LLM 调用）→ 产出 ResponseAction
```

```typescript
interface AgentExecutor {
  /** 接收组装好的上下文，返回响应动作 */
  execute(context: AssembledContext, triggerMessage: Message): Promise<ResponseAction>;
}

type ResponseAction =
  | { type: "reply"; message: Omit<Message, "id" | "timestamp"> }
  | { type: "open-thread"; config: ThreadConfig; firstMessage?: Omit<Message, "id" | "timestamp"> }
```

Agent 的 LLM 调用细节（model、temperature、structured output）封装在 `execute` 内部，对 Chat Ability 不可见。

### 1.3 Agent 协作模式

Agent 之间通过消息和 intent 协作，不直接调用彼此：

```
分析类 agent（summary / info-check / polish）
  │  产出消息，可能包含 intent { kind: "write-codoc-field", status: "proposed" }
  │
  ▼
codoc-agent（daemon 模式，监听 write intent）
  │  检测到 intent → 回复确认提议 / 或等待用户 confirm
  │
  ▼
用户 confirm → Codoc Use 执行写入
```

这个链条中：
- 分析类 agent 不需要知道 codoc-agent 的存在，只需要知道 `write-codoc-field` 这个 intent 类型
- codoc-agent 不需要知道是哪个 agent 产出了 intent，只关心 intent 本身
- 解耦通过 intent 类型实现，不通过 agent 间直接引用

---

## 二、预置 Agent 定义

### 2.1 codoc-agent

专司 codoc 的增删改查。唯一在职责上与 codoc 写操作直接相关的 agent。

```typescript
const codocAgent: Participant = {
  id: "codoc-agent",
  kind: "agent",
  name: "Codoc",
  description: "管理 codoc 的创建、读取、更新和删除。",
  contextRequirements: [
    { sourceKind: "codoc-snapshot", priority: "required" },
    { sourceKind: "chat-history", priority: "optional", maxTokens: 1000 },
  ],
  responseMode: {
    type: "daemon",
    filter: {
      intentKinds: ["write-codoc-field", "create-codoc", "delete-codoc", "force-codoc-field"],
      resourceKinds: ["codoc"],
    },
  },
};
```

**职责：**
- 响应用户的 codoc 操作请求（`@codoc-agent 创建一个新的 codoc`）
- 监听其他 agent 产出的 codoc 写入 intent，提议或执行
- 响应 workspace 变更通知（stale 字段的 re-force 建议）

**能力边界：**
- 可以产出 codoc 相关 intent（write / create / delete / force）
- 不做内容理解或分析——不总结、不校验、不润色

**响应策略：**
- daemon 模式监听两类消息：(a) 包含 codoc write intent 的消息，(b) 包含 codoc resource ref 的用户消息
- 被 @mention 时无条件响应
- 复杂任务（如跨多个 codoc 的批量操作）可开子 thread

### 2.2 summary-agent

对上下文进行结构化总结。上下文可以是对话历史、codoc 内容、或两者的组合。

```typescript
const summaryAgent: Participant = {
  id: "summary-agent",
  kind: "agent",
  name: "Summary",
  description: "对上下文进行结构化总结。",
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required" },
    { sourceKind: "quoted-messages", priority: "optional" },
    { sourceKind: "codoc-snapshot", priority: "optional" },
  ],
  responseMode: { type: "on-mention" },
};
```

**关键设计：** required 上下文是 `chat-history`，不是 codoc。codoc 是 optional 的补充。

- `@summary-agent` 不带 codoc reference → 总结当前对话
- `@summary-agent` 带 codoc reference → 结合对话和 codoc 内容总结
- `@summary-agent` + quote 几条消息 → 只总结被 quote 的内容

如果 summary 结果需要写入 codoc 字段，产出 `intent { kind: "write-codoc-field" }`，不自己写入。

### 2.3 info-check-agent

校验 codoc 中字段值的一致性、时效性和引用有效性。

```typescript
const infoCheckAgent: Participant = {
  id: "info-check-agent",
  kind: "agent",
  name: "Info Check",
  description: "校验 codoc 字段的一致性、时效性和引用有效性。",
  contextRequirements: [
    { sourceKind: "codoc-snapshot", priority: "required" },
    { sourceKind: "chat-history", priority: "optional", maxTokens: 500 },
  ],
  responseMode: { type: "on-mention" },
};
```

required 上下文是 `codoc-snapshot`——没有 codoc 它无法工作。输出是校验报告。如果发现需要修正的字段，产出 write intent 交给 codoc-agent。

### 2.4 polish-agent

润色 codoc 中文本字段的表达质量，保持 schema 结构不变。

```typescript
const polishAgent: Participant = {
  id: "polish-agent",
  kind: "agent",
  name: "Polish",
  description: "润色 codoc 中文本字段的表达质量。",
  contextRequirements: [
    { sourceKind: "codoc-snapshot", priority: "required" },
  ],
  responseMode: { type: "on-mention" },
};
```

对每个润色后的字段产出 write intent，用户逐个 confirm。

---

## 三、Command 映射

`/command` 是 `@mention` 的语法糖。每个 agent 自动获得一个以其 id 为名的 command：

| Command | 等价于 |
|---------|--------|
| `/summary` | `@summary-agent`，附带当前 references |
| `/check` | `@info-check-agent`，附带当前 references |
| `/polish` | `@polish-agent`，附带当前 references |
| `/codoc` | `@codoc-agent`，附带当前 references |

Command 不是独立的概念，不需要单独注册。未来用户自定义的 agent 自动获得对应 command。

---

## 四、Agent 注册

预置 agent 在 session 创建后统一注册：

```typescript
function registerPresetAgents(chat: ChatAbility, sessionId: string) {
  const agents = [codocAgent, summaryAgent, infoCheckAgent, polishAgent];
  for (const agent of agents) {
    chat.registerParticipant(sessionId, agent);
  }
}
```

注册只是声明参与者。agent 的执行器（AgentExecutor）单独绑定——这让参与者声明和执行逻辑分离，便于测试和替换。

---

## 五、扩展策略

### 5.1 用户自定义 agent

未来用户可以通过提供以下信息创建自定义 agent：
- System prompt
- Context requirements（从预定义的 sourceKind 中选择）
- Response mode（on-mention / daemon + filter）

自定义 agent 使用与预置 agent 相同的 Participant 接口，注册后立即可用。

### 5.2 新增预置 agent

添加新的预置 agent 只需：
1. 定义 Participant（id、contextRequirements、responseMode）
2. 实现 AgentExecutor（system prompt + LLM 调用逻辑）
3. 加入 `registerPresetAgents` 列表

不需要修改 Chat Ability、Codoc Use 或 Cobook Workspace。

---

## 六、Agents 的边界

Agents **做**的事情：
- 定义每个 agent 的身份、上下文需求、响应模式
- 实现 agent 的执行逻辑（system prompt + LLM 调用）
- 定义 agent 间的协作模式（通过 intent 解耦）
- Command 到 mention 的映射

Agents **不做**的事情：
- 不定义 codoc 的资源/上下文/intent 类型（那是 Codoc Use 的事）
- 不直接操作 Workspace API（通过 intent 间接操作）
- 不管理消息路由（那是 Chat Ability 的事）
- 不管理 UI（那是 Cobook Workspace 的事）
