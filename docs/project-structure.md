# Cobook 项目目录结构

## 技术选型

| 层 | 技术 |
|---|------|
| 前端 | Vite + React + shadcn/ui + Vercel AI Elements |
| API | Hono |
| CLI | Commander.js |
| ORM | Drizzle ORM |
| 存储 | PostgreSQL |
| AI | Anthropic SDK（server 端）+ Vercel AI Elements（web 端） |
| 校验 | Zod |
| 构建 | Turborepo + tsup |

## UI 设计

### 整体布局

Web 端采用三栏布局，CLI 端映射为等价的命令交互：

```
┌─────────────────────────────────────────────────────────────────┐
│  Masthead: workspace 名称 · 路径 · build 状态 pill              │
├──────────┬───────────────────────────┬──────────────────────────┤
│          │                           │                          │
│  Sidebar │     Detail Panel          │     Chat Panel           │
│          │                           │                          │
│  codoc   │  ┌─────────┬──────────┐   │  agent picker            │
│  列表     │  │  View   │  Data    │   │  message input           │
│          │  │ 渲染面    │ resolved │   │  transcript              │
│  按文件   │  └─────────┴──────────┘   │  event log               │
│  树形组织 │                           │                          │
│          │  Node States              │                          │
│          │  节点状态列表               │                          │
│          │                           │                          │
├──────────┴───────────────────────────┴──────────────────────────┤
│  响应式：≤1200px 折叠为单栏垂直堆叠                                │
└─────────────────────────────────────────────────────────────────┘
```

### 视觉风格

| 维度 | 规范 |
|------|------|
| 色调 | 暖色纸质底色 `#f4efe6`，面板 frosted glass 效果 |
| 强调色 | 赭红 `#b6542b`，用于 eyebrow、active 态、状态 pill |
| 字体 | 正文 sans-serif，标题 serif（editorial 感），代码 monospace |
| 圆角 | 面板 24px，子面板 18px，按钮/pill 999px（胶囊） |
| 阴影 | 大投影 `0 22px 60px` 暖棕色调，营造纸面浮起感 |
| 状态色 | 正常 `#2d6a4f`（绿），警告 `#9a3412`（深橙） |

### 页面流

```
Workspace 列表页 ──点击──▸ Workspace 首页（三栏）
     ↑                        │
     └── 返回 ◂───────────────┘
```

### 核心页面/视图

#### 0. Workspace 列表页

Web 的入口页面。用户在此选择或管理要打开的 workspace。

```
┌─────────────────────────────────────────────────────────┐
│  Cobook                                    [+ 添加]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  📂 my-notes                                    │    │
│  │  /Users/me/projects/my-notes                    │    │
│  │  12 codocs · Build Ready ●                      │    │
│  │  最近打开：2 小时前                                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  📂 research-feed                               │    │
│  │  /Users/me/projects/research-feed               │    │
│  │  47 codocs · Build Error ●                      │    │
│  │  最近打开：昨天                                    │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐    │
│    输入路径或拖入文件夹以添加 workspace                   │    │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- **Workspace 卡片**：名称（来自 `cobook.yaml`）、根路径、codoc 数量、build 状态 pill、最近打开时间
- **操作**：点击卡片 → 进入该 workspace 三栏首页；hover 显示移除按钮
- **添加 workspace**：顶部 [+ 添加] 按钮或底部拖放区域，输入本地路径
- **数据来源**：server 维护已注册的 workspace 列表，持久化到 PostgreSQL

#### 1. Workspace 首页

- **Masthead**：workspace 名称 + 根路径 + build 状态 pill（Ready / Error）
- **Sidebar（左栏）**：codoc 列表，点击选中，active 态高亮
- **Detail Panel（中栏）**：选中 codoc 的完整信息
  - View 区域：渲染 codoc 的 view 层（支持 stack / grid / section / tabs / timeline 等布局组件）
  - Data 区域：resolved data 的 JSON 展示
  - Node States：该 codoc 关联的 DAG 节点状态（status + dependents）

#### 2. Chat Panel（右栏）

- **Agent Picker**：下拉选择场景 agent（Base / RSS / ...），显示 agent 描述和 pinned codocs
- **Message Input**：多行文本框，发送后自动 pin 当前选中的 codoc 作为上下文
- **Transcript**：agent 返回的事件流（message / status / artifact），倒序展示
- **Event Log**：workspace 文件变更事件（SSE 实时推送），显示 change kind + path + affected nodes

#### 3. Codoc View 渲染

View 层支持以下布局原语，可嵌套组合：

| 组件 | 说明 |
|------|------|
| `stack` | 垂直堆叠，支持 gap-sm/md/lg |
| `grid` | 网格布局，支持 1-3 列 |
| `section` | 带边框的卡片容器 |
| `tabs` | 标签页切换 |
| `timeline` | 时间线，左侧装饰轨道 + 右侧卡片 |
| `text` | 文本节点，支持 tone（muted / eyebrow / title） |
| `markdown` | Markdown 渲染块 |
| `table` | 数据表格 |
| `json` | JSON 格式化展示 |
| `component` | 自定义组件卡片（hero-card / local-hero-card / unsupported） |

#### 4. 实时性

- **SSE（Server-Sent Events）**：`/api/events` 推送 workspace 文件变更
- 收到事件后自动刷新 snapshot（codoc 列表 + diagnostics + 当前 codoc 详情）
- Chat 发送后同样触发刷新，确保 agent 创建的新 codoc 立即可见

### CLI 交互映射

| Web 视图 | CLI 等价命令 |
|----------|-------------|
| Workspace 列表页 | `cobook workspaces` |
| Sidebar codoc 列表 | `cobook status` / `cobook list` |
| Detail Panel | `cobook show <codoc-id>` |
| Data 区域 | `cobook resolve <node-id>` |
| Node States | `cobook diagnostics` |
| Graph 可视化 | `cobook graph` |
| Chat Panel | `cobook chat [--agent <id>] [--pin <codoc-id>]` |
| Event Log | `cobook watch`（流式输出变更事件） |

### 响应式策略

- `≤1200px`：三栏折叠为单栏垂直堆叠
- Grid 列数退化为 1 列
- Timeline 隐藏左侧装饰轨道
- Masthead 改为纵向排列

## 目录结构

```
codoc/
├── apps/
│   ├── cli/                              # CLI 薄客户端（无状态，通过 RPC 连 server）
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts               # cobook init
│   │   │   │   ├── build.ts              # cobook build
│   │   │   │   ├── show.ts               # cobook show <path>
│   │   │   │   ├── graph.ts              # cobook graph
│   │   │   │   ├── resolve.ts            # cobook resolve <path>
│   │   │   │   ├── status.ts             # cobook status
│   │   │   │   └── chat.ts              # cobook chat（终端对话）
│   │   │   ├── rpc/
│   │   │   │   └── client.ts             # RPC 连接管理（stdio/TCP → server）
│   │   │   ├── render/
│   │   │   │   ├── table.ts              # 表格输出
│   │   │   │   ├── tree.ts               # 树形输出
│   │   │   │   └── stream.ts             # 流式输出（chat）
│   │   │   └── index.ts                  # CLI 入口，命令路由
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                           # API 服务（HTTP，统一 service 边界）
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── workspace.ts          # /api/workspace/*
│   │   │   │   ├── codoc.ts              # /api/codoc/*
│   │   │   │   ├── graph.ts              # /api/graph/*
│   │   │   │   └── chat.ts              # /api/chat/*（流式）
│   │   │   ├── middleware/
│   │   │   │   ├── error-handler.ts
│   │   │   │   └── workspace-ctx.ts      # 请求级 workspace 上下文
│   │   │   └── index.ts                  # 服务启动入口
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                              # Web 前端
│       ├── src/
│       │   ├── components/
│       │   │   ├── ui/                   # shadcn/ui 组件
│       │   │   ├── codoc/
│       │   │   │   ├── codoc-card.tsx
│       │   │   │   ├── codoc-editor.tsx
│       │   │   │   └── codoc-viewer.tsx
│       │   │   ├── graph/
│       │   │   │   └── graph-canvas.tsx  # DAG 可视化
│       │   │   ├── chat/
│       │   │   │   ├── chat-panel.tsx    # AI Elements 集成
│       │   │   │   └── message-list.tsx
│       │   │   └── workspace/
│       │   │       ├── sidebar.tsx
│       │   │       └── status-bar.tsx
│       │   ├── pages/
│       │   │   ├── workspace.tsx
│       │   │   ├── codoc-detail.tsx
│       │   │   ├── graph.tsx
│       │   │   └── chat.tsx
│       │   ├── hooks/
│       │   │   ├── use-codoc.ts
│       │   │   ├── use-graph.ts
│       │   │   └── use-chat.ts
│       │   ├── lib/
│       │   │   └── api-client.ts         # 对 server 的 HTTP 封装
│       │   ├── app.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── components.json               # shadcn/ui 配置
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── core/                             # 纯核心层（零副作用）
│   │   ├── src/
│   │   │   ├── parser/
│   │   │   │   ├── codoc-parser.ts       # .codoc 文件 → AST
│   │   │   │   └── schema.ts             # codoc 结构定义（Zod）
│   │   │   ├── ref/
│   │   │   │   ├── ref-parser.ts         # $ref 语法解析
│   │   │   │   ├── ref-normalizer.ts     # 路径规范化 → NodeId
│   │   │   │   └── ref-types.ts
│   │   │   ├── dag/
│   │   │   │   ├── dag.ts                # 字段级 DAG 数据结构
│   │   │   │   ├── topo-sort.ts          # 拓扑排序
│   │   │   │   ├── cycle-detect.ts       # 循环检测
│   │   │   │   └── invalidate.ts         # 失效传播算法
│   │   │   ├── validate/
│   │   │   │   ├── schema-validator.ts
│   │   │   │   └── ref-validator.ts      # 引用合法性校验
│   │   │   ├── state/
│   │   │   │   └── node-state.ts         # idle/computing/ready/dirty/error 状态机
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   │   ├── parser.test.ts
│   │   │   ├── ref.test.ts
│   │   │   ├── dag.test.ts
│   │   │   ├── validate.test.ts
│   │   │   └── state.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── service/                          # 服务层（副作用集中在此）
│   │   ├── src/
│   │   │   ├── workspace/
│   │   │   │   ├── workspace-service.ts  # 打开/初始化/扫描 workspace
│   │   │   │   └── workspace-watcher.ts  # 文件变更监听
│   │   │   ├── runtime/
│   │   │   │   ├── build.ts              # build：codoc 集合 → DAG
│   │   │   │   ├── resolver.ts           # resolve：按需求值
│   │   │   │   └── orchestrator.ts       # 编排 build/resolve 流程
│   │   │   ├── source/
│   │   │   │   ├── source-executor.ts    # source 统一执行入口
│   │   │   │   ├── static-source.ts
│   │   │   │   ├── file-source.ts
│   │   │   │   └── codoc-source.ts       # $ref → codoc 字段值
│   │   │   ├── ai/
│   │   │   │   └── chat-service.ts       # 会话管理、流式输出
│   │   │   ├── codoc/
│   │   │   │   └── codoc-service.ts      # codoc CRUD（经过 service 边界）
│   │   │   ├── repositories/
│   │   │   │   ├── postgres-document-repository.ts
│   │   │   │   ├── postgres-agent-session-repository.ts
│   │   │   │   └── types.ts             # Repository 接口定义
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   │   ├── workspace.test.ts
│   │   │   ├── runtime.test.ts
│   │   │   ├── source.test.ts
│   │   │   └── ai.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── agent/                            # Agent 层（base-agent + 场景 agent 路由）
│   │   ├── src/
│   │   │   ├── base-agent.ts             # 基础 agent：读/写 codoc、查图、列 agent
│   │   │   ├── router-agent.ts           # 场景路由：优先匹配活跃场景，再按 shouldHandle 分发
│   │   │   ├── scenes/
│   │   │   │   ├── types.ts              # SceneAgent 接口 + SceneAgentSessionState
│   │   │   │   └── rss-scene.ts          # RSS 场景：订阅 feed → 生成 source codoc → 讨论条目
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   │   ├── base-agent.test.ts
│   │   │   └── router-agent.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── db/                               # PostgreSQL 存储层
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── workspace.ts          # workspaces 表
│   │   │   │   ├── codoc.ts              # codocs 表（AST + resolved value）
│   │   │   │   ├── edge.ts               # edges 表（字段级依赖关系）
│   │   │   │   ├── chat.ts               # chat_threads + messages 表
│   │   │   │   └── index.ts
│   │   │   ├── migrations/               # Drizzle 迁移文件
│   │   │   ├── client.ts                 # DB 连接管理
│   │   │   └── index.ts
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                           # 共享类型与工具
│       ├── src/
│       │   ├── types/
│       │   │   ├── codoc.ts              # Codoc, CodocMeta, CodocData, CodocView
│       │   │   ├── ref.ts                # Ref, NodeId
│       │   │   ├── graph.ts              # DAGNode, DAGEdge
│       │   │   ├── workspace.ts          # WorkspaceConfig
│       │   │   ├── source.ts             # SourceType, SourceResult
│       │   │   └── state.ts              # NodeState enum
│       │   ├── errors.ts                 # 统一错误类型
│       │   ├── constants.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── cobook.yaml                           # 示例 workspace 配置（dogfooding）
├── design.md
├── docs/
│   ├── test-cases.md
│   └── project-structure.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── tsconfig.json
├── turbo.json
└── .gitignore
```

## 包依赖关系

```
shared ← core ← service ← server（唯一事实来源）
                    ↑         ↑
                   db       agent

cli → RPC client → server
web → HTTP client → server
```

Server 是唯一持有 `LocalCobookService` 的进程。CLI 和 Web 都是无状态薄客户端。

| 包 | 依赖 | 说明 |
|---|------|------|
| `@cobook/shared` | 无 | 纯类型和常量 |
| `@cobook/core` | shared | 纯计算，零副作用 |
| `@cobook/db` | shared, drizzle-orm, pg | PostgreSQL 存储 |
| `@cobook/service` | core, db, shared | 副作用集中层，repository 持久化 |
| `@cobook/agent` | service, shared | base-agent + router-agent + 场景 agent |
| `apps/server` | service, agent | **唯一事实来源**：持有 LocalCobookService，暴露 RPC/HTTP API |
| `apps/cli` | shared | 薄客户端，通过 RpcCobookService 经 stdio/TCP 连 server |
| `apps/web` | 独立 | 薄客户端，通过 api-client 经 HTTP 连 server |

## 场景 Agent 架构

### 概念模型

```
用户消息 → RouterAgent
              ├── 优先匹配 input.agentId（用户显式指定）
              ├── 优先匹配 session.activeSceneId（上下文延续）
              ├── 遍历 workspace 启用的 scene，调 shouldHandle() 判断
              └── 全部不匹配 → fallback 到 base-agent
```

### 核心接口

```typescript
// 场景 agent 统一接口
interface SceneAgent {
  id: string;
  shouldHandle(input, service, session): Promise<boolean>;
  run(input, service, session): AsyncIterable<ChatEvent>;
}

// 场景 session（跨轮持久化到 PostgreSQL）
interface SceneAgentSessionState {
  activeSceneId: string | null;
  state: Record<string, unknown>;  // 场景私有状态，泛型存储
}
```

### 参与者

| 角色 | 职责 |
|------|------|
| **base-agent** | 通用能力：读/写 codoc、查询依赖图、列出可用 agent、workspace 概览 |
| **router-agent** | 路由分发：根据 agentId / session / shouldHandle 选择场景，fallback 到 base-agent |
| **scene agent** | 垂直场景：实现 `shouldHandle` + `run`，拥有独立的 session state |

### 场景 agent 注册

场景 agent 在 `cobook.yaml` 中声明启用：

```yaml
agents:
  rss:
    name: RSS Reader
    description: 订阅和浏览 RSS/Atom 源
    pinnedCodocIds: [sources/feeds.codoc]
    outputDir: sources/rss
  # 未来可扩展更多场景
```

对应类型：

```typescript
interface CobookAgentConfig {
  name: string;
  description?: string;
  prompt?: string;           // 场景专属 system prompt
  pinnedCodocIds?: string[]; // 场景自动 pin 的 codoc
  outputDir?: string;        // 场景产出 codoc 的默认目录
}
```

### session 持久化

场景 agent 的会话状态通过 `service.writeAgentSession()` / `readAgentSession()` 持久化到 PostgreSQL，确保跨请求、跨重启的场景连续性。每个场景通过 `state: Record<string, unknown>` 存储私有数据（如 RSS 场景的 `pendingStep: "awaiting_feed_url"`）。

## 设计约束映射

以下是 `design.md` 中的架构约束如何在目录结构中体现：

| 约束 | 在结构中的体现 |
|------|---------------|
| CLI 不能直接依赖 core 做业务执行 | `apps/cli` 只依赖 `@cobook/shared`，通过 RPC 连 server，不导入 core/service/agent |
| Agent 不能直接改 workspace 文件 | `agent/` 通过 `CobookService` 接口操作，不直接接触 fs |
| 场景 agent 是二层能力，不是基础设施 | `agent/scenes/` 独立于 `base-agent`，通过 `router-agent` 可选接入 |
| 所有写操作经过统一 service 边界 | `service/codoc/codoc-service.ts` 是唯一写入入口 |
| core 不承载文件系统和网络副作用 | `packages/core/` 内无任何 fs/net 导入 |
| 字段级 DAG 是唯一依赖真相 | `core/dag/` 维护字段级图，`db/schema/edge.ts` 持久化字段级边 |
