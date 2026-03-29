# Cobook Workspace 设计

Cobook Workspace 是应用的容器层。它把 Chat Ability 和 Codoc Use 粘合在一起，加上 UI 布局和 app 级生命周期管理，形成最终的产品。

Workspace 的职责是"组装"，不是"实现"。Chat 的能力在 Chat Ability 层，codoc 的集成在 Codoc Use 层，Workspace 只负责把它们放到正确的位置、给用户提供操作界面。

---

## 一、布局

### 1.1 三栏结构

```
┌──────────────┬─────────────────────────────┬──────────────┐
│              │                             │              │
│  左栏         │       中间：Chat            │  右栏         │
│  Resources   │                             │  Participants│
│              │                             │              │
│  - codoc 列表 │  - 消息流                   │  - agent 列表 │
│  - 搜索/过滤  │  - 输入框                   │  - 状态指示   │
│  - 图谱视图   │  - context bar              │  - 触发操作   │
│              │                             │              │
└──────────────┴─────────────────────────────┴──────────────┘
```

**左栏：Resources panel**

不再叫 "Codoc 列表"，而是 "Resources"。当前只有 codoc 一种资源类型，但预留扩展空间。

- 展示 workspace 内所有 codoc 的索引（通过 Workspace API 的 listDocs）
- 每个条目显示名称和 schema 摘要
- 点击/拖拽将 codoc reference 到 chat（注册 ResourceRef + ContextSource）
- 可切换到图谱视图（展示 codoc 间的依赖关系）

**中间：Chat area**

Chat Ability 的 UI 呈现。

- 消息流：渲染 MessageTree 的 active branch
- 每条消息显示发送者（带 participant identity 和 avatar）
- 消息中的 ResourceRef 渲染为可交互的卡片（codoc 卡片复用 core 的 render engine）
- 消息中的 Intent 渲染为操作卡片（如 write-suggestion，带 confirm/reject 按钮）
- 输入框支持 `@` mention participant、`@` mention codoc、`/` command
- context bar 显示当前 session 中 active 的 references 和 participants

**右栏：Participants panel**

展示当前 session 中的所有参与者。

- 每个 agent 显示名称、描述、当前状态（idle / thinking / responding）
- Daemon 模式的 agent 显示为"监听中"
- 点击 agent 等价于在输入框中键入 `@agent-id`
- 可以从这里动态启用/禁用 agent 的 daemon 模式

### 1.2 响应式折叠

移动端或窄屏时：
- 左栏和右栏收起为可展开的抽屉
- Chat area 占满屏幕
- 通过顶部 bar 的图标切换面板

---

## 二、App 生命周期

### 2.1 启动流程

```
1. 加载 workspace
   └→ workspace = new Workspace(docsDir)
   └→ workspace.listDocs() 获取 codoc 索引

2. 初始化 Chat Ability
   └→ chat = createChatAbility()
   └→ session = chat.createSession(config)

3. 初始化 Codoc Use
   └→ 注册 codoc ContextSource factory
   └→ 桥接 workspace.onFieldChange → chat 系统消息
   └→ 注册 codoc intent 类型的执行逻辑

4. 注册 Agents
   └→ 注册 codoc-agent, summary-agent, info-check-agent, polish-agent
   └→ 绑定各 agent 的执行器（system prompt + LLM 调用）

5. 渲染 UI
   └→ 三栏布局，绑定事件
```

### 2.2 Session 管理

- 一个 workspace 对应一个 long-lived session（MVP）
- 未来可支持多 session（不同的对话主题，不同的 reference 集合）
- Session 的消息历史可选持久化到本地存储（MVP 不持久化，刷新清空）

### 2.3 参与者生命周期

- 预置 agent 在 session 创建时全部注册
- 用户可以在 participants panel 中动态 enable/disable agent
- Disable 一个 agent = 将其 responseMode 改为 passive，不从 session 中移除
- 未来：用户自定义 agent（提供 system prompt + context requirements + response mode）

---

## 三、交互流程

### 3.1 Reference Codoc

```
用户在左栏点击 "report.codoc"
  │
  ├→ Workspace 层：调用 onAddReference("report.codoc")
  │   ├→ 通过 Codoc Use 层注册 ContextSource（codoc-snapshot for report.codoc）
  │   └→ 在 session 中记录 active reference
  │
  └→ UI 层：context bar 中出现 "report.codoc" badge
```

### 3.2 自由聊天

```
用户输入 "这份报告的数据看起来有问题"
  │
  ├→ Chat Ability：创建 Message，进入 Chat Bus
  │   ├→ 默认的通用 assistant（如果存在）响应
  │   └→ daemon agent 过滤，决定是否响应
  │
  └→ 用户看到助手回复（基于聊天历史 + referenced codoc 上下文）
```

### 3.3 显式调用 Agent

```
用户输入 "@summary-agent 总结一下讨论要点"
  │
  ├→ Chat Ability：创建 Message，mentionedParticipants = ["summary-agent"]
  │   └→ summary-agent 被触发
  │       ├→ 上下文组装：chat-history (required) + codoc-snapshot (optional)
  │       ├→ LLM 调用 → 生成总结
  │       └→ 产出 Message（可能包含 write-codoc-field intent）
  │
  ├→ codoc-agent (daemon)：检测到 write-codoc-field intent
  │   └→ 提议 "要把总结写入 report.codoc 的 /summary 字段吗？"
  │
  └→ 用户看到：summary-agent 的总结 + codoc-agent 的写入提议
      └→ 点击 "Confirm" → intent 变为 confirmed → Codoc Use 执行写入
```

### 3.4 Workspace 变更通知

```
codoc-agent 写入 report.codoc 的 /revenue 字段
  │
  ├→ Workspace：标脏传播，dashboard.codoc 的 /total 变 stale
  │
  ├→ Codoc Use 桥接：发出系统消息 "dashboard.codoc /total 已 stale"
  │
  ├→ codoc-agent (daemon)：检测到 stale 通知
  │   └→ "dashboard.codoc 的 /total 字段已过期，是否重新计算？"
  │
  └→ 用户决定是否 confirm force 操作
```

---

## 四、UI 组件职责

### 4.1 组件树

```
<WorkspaceShell>
  ├── <ResourcesPanel>            // 左栏
  │   ├── <CodocList>             // codoc 列表
  │   │   └── <CodocListItem>     // 单个 codoc 条目
  │   └── <DagGraphView>          // 图谱视图（切换）
  │
  ├── <ChatArea>                  // 中间
  │   ├── <ContextBar>            // 当前 active references
  │   ├── <MessageList>           // 消息流
  │   │   └── <MessageRow>        // 单条消息
  │   │       ├── <ParticipantAvatar>
  │   │       ├── <MessageContent>
  │   │       ├── <ResourceCard>  // 消息中的资源卡片
  │   │       └── <IntentCard>    // 消息中的 intent 卡片
  │   └── <ChatInput>             // 输入框
  │       ├── @mention 自动完成（participants + resources）
  │       └── /command 自动完成
  │
  └── <ParticipantsPanel>         // 右栏
      └── <ParticipantRow>        // 单个参与者
          ├── 状态指示（idle/thinking/responding）
          └── enable/disable 开关
```

### 4.2 关键 UI 约定

**消息中的参与者区分**

每个 agent 有自己的名称和颜色标识，不共享一个 "Assistant" 身份。用户一眼能看出这条消息来自 summary-agent 还是 codoc-agent。

**Intent 卡片**

消息中的 intent 渲染为独立的操作卡片，而不是嵌在文本中的 code block。卡片包含：
- intent 的描述（"写入 report.codoc 的 /summary 字段"）
- 预览值
- Confirm / Reject 按钮
- 状态标识（proposed / confirmed / rejected）

**Resource 卡片**

消息中引用的 codoc 渲染为可展开的卡片。收起时显示名称和 schema 摘要，展开后复用 core 的 MDX render engine 渲染完整内容。Stale 状态有明确的视觉标记。

**Daemon 活动指示**

当 daemon agent 正在判断是否响应时，participants panel 中对应的 agent 显示微妙的活动动画，让用户知道有 agent 在"思考"。

---

## 五、状态管理

### 5.1 状态分布

| 状态 | 所在层 | 说明 |
|------|--------|------|
| codoc 数据 | CoDoc Core (CodocRuntime) | 字段值、staleness |
| codoc 索引 | CoDoc Core (Workspace) | listDocs 结果 |
| 消息、分支 | Chat Ability (Session) | MessageTree |
| 上下文源 | Chat Ability (Session) | 注册的 ContextSource |
| 参与者状态 | Chat Ability (Session) | Participant 列表和响应状态 |
| active references | Cobook Workspace | 当前 session 引用了哪些 codoc |
| UI 状态 | Cobook Workspace | 面板展开/收起、选中项等 |

### 5.2 不引入额外状态管理框架

- Chat Ability 的 Session 自带事件系统，React 通过 useSyncExternalStore 接入
- Codoc 状态在 CodocRuntime 中，通过 Workspace 事件通知变更
- App 级 UI 状态用 React 原生 state 管理
- 不需要 Redux/Zustand/Jotai — 状态的 source of truth 都在各自的层中，UI 只做投影

---

## 六、与现有代码的对比

| 现有 | 新设计 |
|------|--------|
| `chat-store.ts` 包含 WritePreview | WritePreview 概念消失，替换为通用的 Intent |
| `agent/route.ts` 必须传 docIds | Agent 从 session 的 context 获取输入，不需要显式传 docIds |
| `commands.ts` 是独立概念 | Command 是 @mention 的语法糖，不是独立机制 |
| `_context.ts` 全局统一组装 | 上下文按 agent 的 contextRequirements 分别组装 |
| `ChatPanel.tsx` 耦合 codoc 写回逻辑 | ChatArea 只渲染消息和 IntentCard，不知道 codoc |
| 匿名 "assistant" | 每条消息有具名的 participant sender |
| 单一 system prompt | 每个 agent 自己的 system prompt + 按需上下文 |

---

## 七、Cobook Workspace 的边界

Cobook Workspace **做**的事情：
- 三栏布局和 UI 组件
- App 启动流程：初始化 workspace → chat → codoc-use → UI
- Session 管理（创建、切换、可选持久化）
- Reference 管理（用户从左栏添加/移除 codoc reference）
- 将 Chat Ability 的事件映射到 UI 更新

Cobook Workspace **不做**的事情：
- 不管理消息路由（Chat Ability 的事）
- 不定义 agent（Agents 层的事）
- 不执行 codoc 操作（Codoc Use 的事）
- 不调用 LLM（Agent 实现的事）
- 不管理 codoc 数据（CoDoc Core 的事）
