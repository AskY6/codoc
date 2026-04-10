# Cobook Design

## 1. Cobook 是什么

Cobook 不是单纯的 AI 聊天工具，也不是普通文档系统。

它要解决的是另一类问题：

- 外部信息会不断流入，但大多数 AI 对话产出是一次性的
- 知识会被讨论、加工、沉淀，但通常很难稳定复用
- 文档、数据、视图、AI 操作经常分散在不同系统里

Cobook 的答案是：把知识工作收敛到一种统一单元 `codoc`，再用显式引用把这些单元组织成一张可计算的图。

核心价值链：

```text
$source（外部世界）
  -> codoc（结构化单元）
  -> AI / Chat（加工、讨论、提炼）
  -> 新 codoc（知识沉淀）
  -> 被后续 codoc 继续引用和组合
```

## 2. 核心对象

### 2.1 Workspace

一个 workspace 是一组 codoc 的协作边界，持久化在 PostgreSQL 的 `workspaces` 表里。

workspace 负责：

- 聚合同一主题下的 codoc、chat thread 和 agent session
- 绑定默认启用的 agent（`workspace_agents`）
- 作为 runtime build / resolve 和权限隔离的单位

用户创建 workspace 的主路径是通过 preset（例如 `ai-dev-radar`），preset 会一次性生成若干 codoc 并注册默认 agent。workspace 不再绑定某个本地目录，也没有 `cobook.yaml`。

### 2.2 Codoc

`codoc` 是 Cobook 的最小知识单元。它是一行数据库记录，同时也是一段可计算、可校验、可被引用的结构化对象。

每一条 codoc 至少包含：

- `content`: 原始 YAML 文本（用户/agent 编辑的对象）
- `ast`: 解析后的结构
- `resolvedValue`: runtime 求值结果
- `nodeState`: 节点状态（idle / dirty / ready / error ...）

稳定形态上，content 中可以声明以下几段：

- `meta`: 约束和描述（title、description、tags、schema）
- `data`: 数据声明与引用
- `view`: 呈现层
- `component`: 组件注册表，属于扩展能力，不是 MVP 核心

其中最重要的是 `data` 和 `view`：

- `data` 负责表达“这个 codoc 依赖什么、产出什么”
- `view` 负责表达“这个 codoc 如何被阅读和消费”

### 2.3 Ref

`$ref` 是 codoc 之间建立关系的唯一显式机制。

它承担三件事：

- 声明依赖
- 形成图结构
- 让 runtime 能做解析、失效传播和增量计算

设计上，Cobook 倾向于显式引用，而不是隐式上下文拼接。

### 2.4 Graph

所有 codoc 的依赖关系最终会归一到一张字段级 DAG，持久化在 `edges` 表。

这张图是系统的计算核心。它决定：

- 依赖是否合法
- 是否存在循环
- 哪些节点需要先算
- 哪些节点在上游变化后失效

Codoc 级依赖图只是字段级图的投影，不是独立真相。

## 3. 设计原则

### 3.1 一切沉淀为 codoc

AI 对话、外部抓取、用户整理后的结果，最终都应当尽可能落成 codoc，而不是只停留在对话历史里。

### 3.2 显式依赖优先于隐式魔法

依赖关系应该通过 `$ref`、`$source`、schema 和服务接口表达，而不是藏在 prompt、组件副作用或 CLI 临时逻辑里。

### 3.3 字段级图是真相

系统内部的真实依赖粒度应该足够细，至少细到 `data` 字段级别。
更粗的 codoc 级视图可以派生，但不能反过来主导运行时。

### 3.4 数据库是单一事实来源

所有状态——workspace、codoc、edges、chat、agent session——都住在 PostgreSQL。Server 是唯一持有 service 的进程，Web 和 CLI 都是纯 HTTP 客户端。

这意味着：

- Server 不读写文件系统（`apps/server` 和 `packages/service` 没有 `node:fs` / `node:path` 依赖）
- Service 层只通过 repository 接口进出数据库
- CLI 和 Web 共享同一套 HTTP API，没有“本地状态”

### 3.5 Core 保持纯，副作用集中

`core` 负责：

- 解析
- 规范化
- 校验
- 建图
- 运行时状态机

数据库、网络、LLM 调用、source provider 执行都属于副作用，应集中在 service 层，而不是散落在 UI 或 parser 里。

### 3.6 AI 也是系统内参与者，不是旁路

AI 不应绕过系统直接改数据或凭空组织上下文。
它应该通过 service 接口读取 codoc、查询图、生成新 codoc，并触发重建与校验。

## 4. 系统分层

系统分为 5 层：

```text
UI Layer
  apps/web（三栏布局）
  apps/cli（Commander.js）

Server Layer
  apps/server（Hono HTTP + SSE，唯一持有 service 的进程）

Service Layer
  packages/service
    workspace-service, chat-service
    source-executor / source provider 注册
    repository 实现（PostgreSQL via Drizzle）

Core Layer
  packages/core
    parser, ref normalization, schema validation
    DAG, invalidate, node state machine

Database
  PostgreSQL（workspaces, codocs, edges,
              chat_threads, chat_messages,
              thread_codocs, thread_agents,
              workspace_agents, agent_sessions）
```

### 4.1 UI Layer

Web 和 CLI 都是薄客户端。它们不持有 workspace 状态，不访问文件系统，不直接依赖 core。

UI 的职责只有：

- 接收用户输入
- 展示流式输出
- 命令路由和结果格式化

Web 用 React + Vite + Tailwind + AI Elements 渲染三栏布局（sidebar / detail / chat）。CLI 用 Commander 把同一套 API 暴露成终端命令。

### 4.2 Server Layer

`apps/server` 是唯一的 service 持有者，基于 Hono：

- `/api/workspace/*` workspace 与 codoc CRUD、build、resolve、graph
- `/api/chat/*` 多 agent chat、SSE 流式推送、@mention 路由
- RSS scheduler 等后台任务
- 统一事件广播（codoc 变更 → SSE 推送到 Web）

Server 不读写文件系统；需要访问用户本机能力的场景（例如读取本地 Claude Code 会话日志），由独立的 local-connector daemon 在浏览器侧提供。

### 4.3 Service Layer

Service Layer 是所有副作用的集中点。

它负责：

- 打开 workspace、写入 codoc、维护 edges
- 调用 core 做 parse / build / resolve
- 执行 source provider（静态、内置、`local:*` 客户端占位）
- 管理 chat thread / message / thread codocs / thread agents
- 管理 agent session 状态

Service 只依赖 `@cobook/core` 和数据库，没有 `node:fs` / `node:path` 依赖。

### 4.4 Core Layer

Core Layer 只关心语义和计算，不关心终端、浏览器、网络传输和数据库细节。

它输出的核心能力：

- 从 codoc 内容得到标准 AST
- 从 `$ref` 得到稳定 NodeId
- 从 codoc 集合得到 DAG
- 在拓扑序基础上暴露求值和失效的原语
- 在结构变化和值变化之间做清晰区分

### 4.5 Database

PostgreSQL（Drizzle ORM）承载所有持久状态。核心表：

- `workspaces` — 工作区元数据
- `codocs` — 每一条结构化单元（content + ast + resolvedValue + nodeState）
- `edges` — 字段级依赖图
- `chat_threads` / `chat_messages` — 会话与消息（消息带 `agent_id`）
- `thread_codocs` — 线程当前引入的 codoc 上下文
- `thread_agents` / `workspace_agents` — 线程与工作区启用的 agent
- `agent_sessions` — agent 跨轮持久化的私有状态

## 5. 运行时模型

### 5.1 数据声明

`data` 不是单纯的静态值容器，而是依赖声明与求值入口。

当前通过 `SourceProvider` 注册表动态管理 source 类型：

- `static`
- `codoc` / `$ref`
- 任意注册到 service 层的 server-side provider（例如 RSS、HTTP）
- `local:*` 前缀的客户端 source（由浏览器侧的 local-connector 在用户授权的本地目录中执行）

一个 source 是 server 还是 client 由 `isClientSource(name)` 决定：名字以 `local:` 开头的 source 永远不在 server 上求值。

### 5.2 Build 与 Resolve

运行时区分两类动作：

- `build`: 从 codoc 集合建图、校验、持久化节点和边
- `resolve`: 在已有图上按需求值某个节点

它们不是一回事：

- `build` 解决结构正确性
- `resolve` 解决值计算

### 5.3 结构变化与值变化

系统从一开始就区分这两类变化：

- 结构变化：codoc content 被改写，导致 AST、节点或边改变
- 值变化：某个 source 的结果变了，但依赖结构没变

这两种变化的处理路径不能混为一谈。

### 5.4 错误边界

错误被视为节点状态的一部分，而不是异常地散落出去。

至少支持的状态语义：

- `idle`
- `computing`
- `ready`
- `dirty`
- `error`

无论 CLI 展示、Web 展示还是 agent 恢复，都基于这一套统一状态。

## 6. AI 与交互模型

### 6.1 Router + Specialist 多 Agent

Chat 采用 router + specialist 模型。一个 thread 里可以涉及多个 agent，每一条 assistant 消息都带 `agent_id`，明确归属。

消息流：

```text
用户消息（可能带 @agent-id）
  ↓
Router Agent
  ├── 自己能回 → 直接以 router 身份回
  └── 需要专家 → 抽取相关上下文 → 交给最匹配的 specialist
                                     ↓
                                Specialist 回复（tagged as agent-x）
```

核心约束：

- 每条用户消息只产生一条响应，要么 router，要么恰好一个 specialist，绝不同时
- 路由过程静默，不发“正在转交给 X”的中间消息
- 所有 agent 共享同一份 chat context，router 在交接时抽取与场景相关的片段
- 用户可以用 `@agent-id` 明确指定，跳过路由
- 每条 assistant 消息持久化 `agent_id`，UI 基于它展示身份

### 6.2 Base / Specialist Agents

当前落地的 agent：

- **Base Agent** — 通用工作区助手：读/写 codoc、查询依赖图、管理 thread context
- **RSS Agent** — 订阅、拉取并整理 RSS/Atom 源，配合 RSS source provider 和后台 scheduler
- **Claude Code Log Agent** — 解析本地 Claude Code 会话日志（通过 local-connector 读取用户授权目录）

Agent 不直接碰数据库或文件系统，统一通过 `WorkspaceService` + `AgentSessionRepository` 操作。

### 6.3 Chat 是能力入口，不是系统本体

Chat 很重要，但不应主导设计。
真正的本体仍然是 codoc 图谱和 runtime。

换句话说：

- Chat 是操作系统的终端
- codoc 图谱才是操作系统管理的对象

### 6.4 上下文应该可控

AI 的输入边界需要显式控制。当前通过以下机制体现：

- `thread_codocs`：明确 pin 到当前 thread 的 codoc
- `thread_agents`：明确在当前 thread 中启用的 agent
- Router 在交接前对上下文做抽取

目标：

- 控制 token 预算
- 让 AI 感知范围可解释
- 让用户知道 AI 是基于什么在行动

## 7. 扩展模型

### 7.1 Source 扩展

Source provider 通过 `registerSource(provider)` 注册到 service 层。新增数据源的成本被收敛为“实现 `SourceProvider` 接口 + 注册”。

客户端 source（`local:*`）通过 local-connector 暴露：浏览器在用户授权后连接本机 daemon，由 daemon 负责在本地执行文件读取和 watch，server 完全不参与。

### 7.2 View 与 Component 扩展

`view` 已经支持一组布局原语（`stack` / `grid` / `section` / `tabs` / `timeline` / `text` / `markdown` / `table` / `json` / `component`），可以嵌套组合。自定义 component 是扩展点，但仍然以“先证明数据图谱成立”为前提。

设计顺序：

1. 先证明 data graph 成立
2. 再证明最小 view 渲染成立
3. 最后才扩展完整 MDX 和组件系统

### 7.3 多 Agent 扩展

多 agent 已从“未来能力”落地为“基础设施”。下一步的扩展重点是：

- 更多 specialist agent（按垂直场景）
- Router 的上下文抽取与意图识别的可解释性
- Agent 之间的能力协商与结果归属

## 8. 边界与非目标

以下内容不是当前稳定设计的核心承诺：

- 完整 WebSocket 实时同步（SSE 足够）
- 远程组件加载 / 完整 MDX runtime
- Source 插件市场
- 多用户协同编辑
- 跨 workspace 的全局检索
- local-connector 的 write / execute / network-proxy 能力

这些都可能是后续阶段的重要内容，但不应绑在当前阶段一起落地。

## 9. 当前最重要的架构约束

这几条如果破了，后面很容易返工：

- 数据库是单一事实来源，server 和 service 都不读写文件系统
- CLI 和 Web 都是纯 HTTP 客户端，不直接依赖 core / service
- Agent 不能直接改数据库，所有写入经过 `WorkspaceService`
- `core` 不承载数据库和网络副作用
- 字段级 DAG 依然是唯一依赖真相
- 每条 assistant 消息必须带 `agent_id`，不允许匿名

## 10. 当前的开放问题

这些问题可以延后，但不能永远模糊：

- `derived` 计算最终是允许受限 JS，还是要收敛成 DSL
- Source 的 cache / retry / watch 在哪一层建模最合理
- Router 如何在跨场景上下文中做更可解释的意图识别
- AI 产出的 codoc 模板和风格如何保持稳定
- local-connector 的权限模型如何扩展到 write / execute

## 11. 文档分工

为了避免把设计、实现、阶段计划混在一起，保持下面的文档职责：

- [DESIGN.md](./DESIGN.md)
  - 描述稳定设计主线
  - 关注对象模型、边界、原则和约束
- [docs/project-structure.md](./docs/project-structure.md)
  - 项目结构、UI 布局与目录细节
- [docs/module-matrix.md](./docs/module-matrix.md)
  - 技术环境 × 逻辑模块的交叉视图
- [docs/roadmap.md](./docs/roadmap.md)
  - 分阶段验收标准
- [CLAUDE.md](./CLAUDE.md)
  - 协作助手的硬约束与操作守则
