# Cobook 设计总览

Cobook 是 CoDoc 的第一个应用层产品——以对话为中心、以 codoc 为知识资产、以多 agent 为能力层的知识工作台。

详细设计见五份子文档：[chat-ability.md](./chat-ability.md) | [codoc-use.md](./codoc-use.md) | [agents.md](./agents.md) | [cobook-workspace.md](./cobook-workspace.md) | [conversational-creation.md](./conversational-creation.md)

---

## 一、核心产品设计

### 交互模型

Chat 是主界面，不是辅助功能。用户在群聊中与多个具名 agent 协作，agent 之间也可以互相响应。

- **@mention** 显式触发 agent，`/command` 是 mention 的语法糖
- **Agent 可自主响应**（daemon 模式），也可以沉默
- **Intent** 是 agent 的行动提案，用户 confirm/reject 后执行——"先预览再操作"是通用交互模式
- **Thread** 可以在任意消息上开启子对话，子 thread 是完整的 chat 环境，resolve 后结论回到父 chat

### 参与者

| Agent | 职责 | 响应模式 | 主要上下文 |
|-------|------|----------|-----------|
| codoc-agent | codoc CRUD，唯一有写权限 | daemon（监听 codoc intent + codoc resource） | codoc-snapshot |
| summary-agent | 结构化总结（对话 / codoc / 混合） | on-mention | chat-history |
| info-check-agent | 校验字段一致性和引用有效性 | on-mention | codoc-snapshot |
| polish-agent | 文本润色 | on-mention | codoc-snapshot |

Agent 之间通过 Intent 协作：分析类 agent 产出 write-intent → codoc-agent 检测并提议执行 → 用户确认 → 写入。

### 可操作对象

| 对象 | 操作 |
|------|------|
| codoc 字段 | read / write / force（通过 intent + codoc-agent） |
| chat 消息 | quote / summarize |
| chat session | branch / thread / clear |

---

## 二、架构分层

```
┌─────────────────────────────────────────────┐
│  Cobook Workspace                           │
│  三栏 UI、app 生命周期、session/reference 管理│
├──────────────────────┬──────────────────────┤
│  Agents              │  Codoc Use           │
│  参与者定义、执行逻辑、│  core 适配层：        │
│  协作模式、command 映射│  resource/context/   │
│                      │  intent/event 桥接    │
├──────────────────────┴──────────────────────┤
│  Chat Ability  (lib, 可复用)                │
│  参与者模型、消息、上下文组装、触发路由、     │
│  intent 生命周期、branch/thread              │
├─────────────────────────────────────────────┤
│  CoDoc Core  (Workspace API)                │
│  codoc 索引、依赖图、标脏传播、CodocRuntime  │
└─────────────────────────────────────────────┘
```

**Agents 和 Codoc Use 是同层但独立的两个关注点：**
- **Codoc Use** 回答"codoc 在 chat 中如何被引用、理解、操作、感知"——纯适配，不知道有哪些 agent
- **Agents** 回答"chat 中有哪些参与者，各自怎么工作"——消费 Chat Ability 原语和 Codoc Use 能力，但不直接操作 core

**分层原则：** 上层不穿透下层 API。Chat Ability 不知道 codoc；Codoc Use 不知道 agent；Agents 不直接调 Workspace API。

**可复用性检验：** 如果明天做一个 "co-code" 应用——Chat Ability 整层复用零修改，Codoc Use 替换为 Code Use，Agents 重新定义一批参与者，Workspace 换 UI 壳。

---

## 三、Chat Ability 核心模型

### 消息

```typescript
Message { sender, content, quotedIds, resourceRefs, mentionedParticipants, intents }
```

消息不只有文本——ResourceRef 关联外部资源，Intent 声明行动意图，mention 触发 agent。

### 上下文管理

- **ContextSource**：可枚举的结构化信息源（chat-history / codoc-snapshot / quoted-messages / ...），惰性 resolve
- **ContextRequirement**：每个 agent 声明需要什么上下文（kind + priority + token 预算）
- **Assembly**：agent 被触发时按其需求从可用源中按需组装，超预算时裁剪 optional 部分
- **Inheritance**：子 thread 通过 ThreadLink 按需读取父上下文（pull 模式），agent 无需感知自己所处层级

### 触发与路由

```
消息 → Chat Bus（Session 作用域）
  ├→ on-mention agent：被 @ 则响应
  ├→ daemon agent：规则过滤 → 可选 LLM 判断 → 响应
  └→ passive agent：不处理
```

响应动作：**reply**（当前 session 回复）或 **open-thread**（开子 session）。

消息路由不穿透 session 边界。子 thread 通过 `postToParent()` 显式向父 chat 推送。

### Session 与 Thread

Session 是递归结构：

```typescript
Session { participants, contextSources, messageTree, threadLink?, threads: Map<msgId, Session> }
```

- **Branch**（水平）：MessageTree 内的分叉，同层替代路径
- **Thread**（垂直）：消息上挂载的子 Session，有自己的参与者和上下文，resolve 后结论回到父 chat

ThreadLink 通信：子→父 query（只读）、子→父 postToParent/resolve（推送）、父→子 不直接通信。

---

## 四、Codoc Use — core 适配层

Codoc Use 将 CoDoc Core 的能力翻译为 chat 原语，分四个维度：

| 维度 | Chat 原语 | 做什么 |
|------|-----------|--------|
| 引用 | ResourceRef | codoc 注册为 `{ kind: "codoc" }` 资源 |
| 理解 | ContextSource | codoc schema+值注册为 `codoc-snapshot` 上下文源，惰性 resolve |
| 操作 | Intent | 定义 write/create/delete/force 四种 intent 类型 + 执行器 |
| 感知 | 系统消息 | workspace.onFieldChange → chat 系统消息（字段变更、stale 传播） |

Codoc Use 不定义 agent，不做权限控制。它只保证：codoc 能被 reference、能被读取为上下文、能通过 intent 被操作、变更能被感知。

---

## 五、Agents — 参与者定义

### 预置 Agent

| Agent | 职责 | 响应模式 | 主要上下文 |
|-------|------|----------|-----------|
| codoc-agent | codoc CRUD | daemon（监听 write intent + codoc resource） | codoc-snapshot |
| summary-agent | 结构化总结（对话 / codoc / 混合） | on-mention | chat-history |
| info-check-agent | 校验字段一致性和引用有效性 | on-mention | codoc-snapshot |
| polish-agent | 文本润色 | on-mention | codoc-snapshot |

### 协作模式

Agent 之间通过 Intent 解耦，不直接调用彼此：

```
分析类 agent 产出 intent { kind: "write-codoc-field", status: "proposed" }
  → codoc-agent (daemon) 检测到 → 提议执行
  → 用户 confirm → Codoc Use 执行器写入
```

`/command` 是 `@mention` 的语法糖，每个 agent 自动获得 `/<agent-id>` command。

---

## 六、Cobook Workspace 组装

### 启动流程

```
1. CoDoc Core
   │  workspace = new Workspace(docsDir)
   │  加载 codoc 索引，建立依赖图
   │
2. Chat Ability
   │  chat = createChatAbility()
   │  session = chat.createSession(config)
   │  此时 session 是空的——没有参与者，没有上下文源
   │
3. Codoc Use（注入 codoc 适配能力）
   │  注册上下文源工厂：codoc-snapshot ContextSource
   │  注册 intent 执行器：write-codoc-field → workspace.write()
   │  桥接事件：workspace.onFieldChange → chat 系统消息
   │
4. Agents（注入参与者）
   │  注册 codoc-agent, summary-agent, info-check-agent, polish-agent
   │  绑定各 agent 的执行器（system prompt + LLM 调用）
   │
5. Cobook Workspace（渲染 UI，绑定交互）
   │  三栏布局
   │  左栏点击 codoc → 注册 ContextSource + 更新 context bar
   │  输入框 @mention / /command → chat.sendMessage()
   │  Intent 卡片 confirm → chat.updateIntentStatus()
```

每一步只依赖上一步的产物，不跨层操作。Codoc Use 和 Agents 分别注入，互不依赖。

### 布局

```
┌──────────────┬──────────────────────┬──────────────┐
│ Resources    │   Chat Area          │ Participants │
│ codoc 列表    │   消息流 + 输入框     │ agent 列表    │
│ 图谱视图      │   context bar        │ 状态 + 开关   │
└──────────────┴──────────────────────┴──────────────┘
```

### 状态分布

每层管自己的状态，不引入额外框架：

| 状态 | 所在层 |
|------|--------|
| codoc 数据/索引 | CoDoc Core |
| 消息/分支/thread | Chat Ability Session |
| 参与者/上下文源 | Chat Ability Session |
| active references / UI | Cobook Workspace |
