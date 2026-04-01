# Cobook Roadmap

> 每一步都有用户可触发、可交互的验收标准。
> 按依赖关系排序：后面的步骤依赖前面步骤的产出。

---

## Phase 0: Monorepo 骨架与构建链

**目标**: 所有 package 和 app 的目录、`package.json`、`tsconfig.json` 就位，`turbo build` / `turbo typecheck` 能跑通。

| # | 任务 | 验收操作 | 预期结果 |
|---|------|---------|---------|
| 0-1 | 创建 `@cobook/shared`、`@cobook/core`、`@cobook/db`、`@cobook/service`、`@cobook/agent` 包骨架 | `pnpm install && pnpm turbo typecheck` | 零错误退出 |
| 0-2 | 创建 `apps/server`、`apps/cli`、`apps/web` 骨架 | 同上 | 零错误退出 |
| 0-3 | 配置 tsup 构建 | `pnpm turbo build` | 每个 package 在 `dist/` 下生成产物 |
| 0-4 | 配置 vitest | `pnpm turbo test` | 各包占位测试通过（至少一个 `expect(true).toBe(true)`） |

---

## Phase 1: Core — 解析、引用、建图

**目标**: 给定 `.codoc` 文件内容（字符串），能解析为 AST、提取 `$ref`、构建字段级 DAG、检测循环、做拓扑排序。纯计算，零副作用。

### 1-1 Codoc Parser

| 验收操作 | 预期结果 |
|---------|---------|
| 在测试中传入一个合法 `.codoc` YAML 字符串，调用 `parseCodoc(content)` | 返回类型安全的 AST 对象，包含 `meta`、`data`、`view` 各段 |
| 传入语法错误的字符串 | 抛出 `ParseError`，附带行号和原因 |
| 传入只有 `meta` 没有 `data`/`view` 的内容 | 解析成功，`data` 和 `view` 为 `undefined` |

### 1-2 Ref 解析与规范化

| 验收操作 | 预期结果 |
|---------|---------|
| 调用 `parseRef("./other.codoc#data.field")` | 返回 `{ path: "./other.codoc", field: "data.field" }` |
| 调用 `normalizeRef(ref, currentCodocPath)` | 返回绝对 NodeId，如 `notes/other.codoc#data.field` |
| 传入不合法的 ref 字符串（如缺少 `#`） | 抛出 `RefError`，说明格式问题 |

### 1-3 字段级 DAG

| 验收操作 | 预期结果 |
|---------|---------|
| 构造 3 个 codoc AST（A→B→C），调用 `buildDAG(codocs)` | 返回 DAG 对象，包含 3 个节点和 2 条有向边 |
| 调用 `topoSort(dag)` | 返回 `[C, B, A]`（被依赖的在前） |
| 构造 A→B→A 的循环，调用 `detectCycles(dag)` | 返回循环路径 `[A, B, A]` |
| 调用 `getUpstream(dag, nodeId)` / `getDownstream(dag, nodeId)` | 返回正确的上下游节点列表 |

### 1-4 失效传播

| 验收操作 | 预期结果 |
|---------|---------|
| DAG 中 A→B→C，标记 A 为 dirty，调用 `invalidate(dag, "A")` | 返回 `["A", "B", "C"]`（所有受影响节点） |
| 标记叶子节点 C 为 dirty | 只返回 `["C"]` |

### 1-5 Schema 校验

| 验收操作 | 预期结果 |
|---------|---------|
| codoc meta 声明 `schema: { title: string, count: number }`，data 满足 | `validateSchema(codoc)` 返回 `{ valid: true }` |
| data 中 `count` 为字符串 | 返回 `{ valid: false, errors: [...] }`，指出字段和原因 |

### 1-6 节点状态机

| 验收操作 | 预期结果 |
|---------|---------|
| 创建 `NodeState`，初始状态 | `state.current === "idle"` |
| 调用 `state.transition("computing")` | 状态变为 `computing` |
| 从 `computing` 调用 `transition("idle")` | 抛出 `InvalidTransition`（不允许的迁移） |
| 完整路径 `idle → computing → ready → dirty → computing → ready` | 每步状态正确 |

---

## Phase 2: DB — PostgreSQL 存储层

**目标**: Drizzle schema 定义 + migration 跑通，能对 workspace、codoc、edge、chat 做 CRUD。

### 2-1 Schema 与 Migration

| 验收操作 | 预期结果 |
|---------|---------|
| 启动本地 PostgreSQL，运行 `pnpm --filter @cobook/db migrate` | 数据库中创建 `workspaces`、`codocs`、`edges`、`chat_threads`、`chat_messages` 表 |
| 用 `psql` 查看 `\dt` | 五张表均存在，字段与 schema 定义一致 |

### 2-2 Repository 接口

| 验收操作 | 预期结果 |
|---------|---------|
| 在测试中调用 `workspaceRepo.create({ name, rootPath })` | 数据库写入成功，返回带 `id` 的 workspace 记录 |
| 调用 `codocRepo.upsert(workspaceId, codocId, ast, resolvedValue)` | 写入成功，再次调用同 id 为更新 |
| 调用 `edgeRepo.replaceAll(workspaceId, edges)` | 清除旧边，写入新边 |
| 调用 `chatRepo.createThread(workspaceId)` 再 `addMessage(threadId, msg)` | 线程和消息都持久化，查询可恢复 |

---

## Phase 3: Service — 副作用集中层

**目标**: `LocalCobookService` 把 core 纯计算 + db 持久化 + 文件 IO 编排起来。CLI/Web/Agent 都通过它操作。

### 3-1 Workspace Service

| 验收操作 | 预期结果 |
|---------|---------|
| 在测试中准备一个包含 `cobook.yaml` 和若干 `.codoc` 文件的临时目录，调用 `service.openWorkspace(dir)` | 返回 workspace 对象，数据库中有记录，所有 codoc 被扫描 |
| 调用 `service.getStatus(workspaceId)` | 返回 codoc 数量、节点状态分布（ready/dirty/error 各几个） |

### 3-2 Build 流程

| 验收操作 | 预期结果 |
|---------|---------|
| 准备含 3 个 codoc（有相互引用）的 workspace，调用 `service.build(workspaceId)` | 解析全部 codoc → 建 DAG → 校验 → 持久化节点和边 → 返回诊断报告 |
| 其中一个 codoc 有循环引用 | build 返回 `diagnostics` 包含循环错误，指出路径 |
| 其中一个 codoc 引用了不存在的路径 | build 返回断引用错误 |

### 3-3 Resolve 流程

| 验收操作 | 预期结果 |
|---------|---------|
| build 成功后，调用 `service.resolve(workspaceId, nodeId)` | 按拓扑序求值，返回 resolved value |
| resolve 一个 static source 节点 | 直接返回内联值 |
| resolve 一个 file source 节点 | 读取本地文件内容作为值 |
| resolve 一个 codoc ref 节点（A 引用 B） | 先 resolve B，再用 B 的值计算 A |

### 3-4 Source 执行器

| 验收操作 | 预期结果 |
|---------|---------|
| 调用 `executeSource({ type: "static", value: { x: 1 } })` | 返回 `{ x: 1 }` |
| 调用 `executeSource({ type: "file", path: "./data.json" })` | 返回文件内容解析后的对象 |
| 文件不存在 | 返回 `SourceError`，附带路径信息 |

### 3-5 Codoc CRUD

| 验收操作 | 预期结果 |
|---------|---------|
| 调用 `service.createCodoc(workspaceId, path, content)` | 文件写入 workspace 目录，触发 build，数据库更新 |
| 调用 `service.updateCodoc(workspaceId, path, newContent)` | 文件更新，增量 rebuild，下游失效传播 |
| 调用 `service.deleteCodoc(workspaceId, path)` | 文件删除，图中节点移除，下游报断引用 error |
| 调用 `service.getCodoc(workspaceId, path)` | 返回完整 codoc 信息：AST + resolved data + node state |

### 3-6 文件监听

| 验收操作 | 预期结果 |
|---------|---------|
| 启动 watcher，在 workspace 目录手动编辑一个 `.codoc` 文件 | service 检测到变更，自动触发增量 rebuild |
| 手动删除一个 `.codoc` 文件 | service 检测到删除，图中该节点移除，下游状态更新 |

---

## Phase 4: Server + CLI — 最小可用交互

**目标**: 用户能通过 CLI 完成 init → build → show → graph → resolve 的完整流程。

### 4-1 Server HTTP API

| 验收操作 | 预期结果 |
|---------|---------|
| 启动 server：`pnpm --filter server dev` | Hono 服务在 `localhost:3100` 启动，日志显示 listening |
| `curl localhost:3100/api/workspace` | 返回已注册 workspace 列表（JSON） |
| `curl localhost:3100/api/workspace/:id/codocs` | 返回该 workspace 的 codoc 列表 |
| `curl localhost:3100/api/workspace/:id/codoc/:path` | 返回单个 codoc 的 AST + resolved data + state |
| `curl localhost:3100/api/workspace/:id/graph` | 返回 DAG 的节点和边（JSON） |
| `curl localhost:3100/api/workspace/:id/build` (POST) | 触发全量 build，返回诊断结果 |
| `curl localhost:3100/api/workspace/:id/resolve/:nodeId` (POST) | 触发 resolve，返回值 |

### 4-2 CLI — init

| 验收操作 | 预期结果 |
|---------|---------|
| 在空目录运行 `cobook init` | 生成 `cobook.yaml`（含项目名），终端打印初始化成功 |
| 在已有 `cobook.yaml` 的目录运行 `cobook init` | 提示已初始化，不覆盖 |

### 4-3 CLI — build

| 验收操作 | 预期结果 |
|---------|---------|
| 在含 3 个 codoc 的 workspace 运行 `cobook build` | 终端显示：扫描到 N 个 codoc → 建图 → M 条边 → 校验结果（通过/失败数） |
| 其中有循环引用 | 终端红色显示循环路径 |

### 4-4 CLI — status

| 验收操作 | 预期结果 |
|---------|---------|
| 运行 `cobook status` | 终端表格显示：codoc 列表 + 每个的状态（ready/dirty/error） + 汇总统计 |

### 4-5 CLI — show

| 验收操作 | 预期结果 |
|---------|---------|
| 运行 `cobook show notes/meeting.codoc` | 终端展示该 codoc 的 meta、data resolved 值、view 定义（格式化输出） |
| 路径不存在 | 终端报错：codoc 不存在 |

### 4-6 CLI — graph

| 验收操作 | 预期结果 |
|---------|---------|
| 运行 `cobook graph` | 终端以 ASCII 树形或列表形式展示全局依赖关系 |
| 运行 `cobook graph notes/meeting.codoc` | 只展示该 codoc 的上下游 |

### 4-7 CLI — resolve

| 验收操作 | 预期结果 |
|---------|---------|
| 运行 `cobook resolve notes/meeting.codoc#data.summary` | 终端输出该字段的 resolved value（JSON） |
| 引用链 A→B→C，resolve A | 终端输出 A 的最终值，过程中 B、C 按序求值 |

### 4-8 端到端冒烟测试

| 验收操作 | 预期结果 |
|---------|---------|
| 在空目录依次执行：`cobook init` → 手动创建 3 个 `.codoc` 文件（含引用关系） → `cobook build` → `cobook status` → `cobook show <path>` → `cobook resolve <nodeId>` → `cobook graph` | 每一步输出合理，无报错，数据一致 |

---

## Phase 5: AI / Chat — Base Agent

**目标**: 用户能通过 CLI 与 base-agent 对话，agent 能读写 codoc、查询图谱，对话持久化到 PostgreSQL。

### 5-1 Chat Service

| 验收操作 | 预期结果 |
|---------|---------|
| 调用 `chatService.createThread(workspaceId)` | 创建线程，持久化到数据库 |
| 调用 `chatService.sendMessage(threadId, "hello")` | 返回 `AsyncIterable<ChatEvent>`，包含 agent 的流式回复 |
| 关闭进程，重新调用 `chatService.getThread(threadId)` | 历史消息从数据库完整恢复 |

### 5-2 Base Agent — 工具调用

| 验收操作 | 预期结果 |
|---------|---------|
| 对 agent 说 "当前项目有哪些 codoc？" | agent 调用 service 查询，回复 codoc 列表及状态 |
| "帮我看看 notes/meeting.codoc 的内容" | agent 调用 service.getCodoc，回复该 codoc 的 data 和 meta 摘要 |
| "这个 codoc 被哪些 codoc 引用了？" | agent 查询 DAG 下游，回复消费者列表 |
| "创建一个新 codoc，名为 summary.codoc，内容为..." | agent 调用 service.createCodoc，回复创建成功，用户可 `cobook show summary.codoc` 验证 |
| "把 summary 字段更新为 xxx" | agent 调用 service.updateCodoc，触发增量 rebuild |

### 5-3 CLI — chat

| 验收操作 | 预期结果 |
|---------|---------|
| 运行 `cobook chat` | 进入交互式对话，显示 agent 名称和 workspace 概览 |
| 输入消息，按回车 | 流式输出 agent 回复（逐 token 显示） |
| Ctrl+C 退出后重新 `cobook chat` | 提示可恢复上次对话或新建 |

### 5-4 Chat HTTP API

| 验收操作 | 预期结果 |
|---------|---------|
| `curl -X POST localhost:3100/api/chat/thread` (body: workspaceId) | 返回新 threadId |
| `curl -N -X POST localhost:3100/api/chat/thread/:id/message` (body: content) | SSE 流式返回 agent 回复事件 |
| `curl localhost:3100/api/chat/thread/:id` | 返回完整历史消息列表 |

---

## Phase 6: Web 前端 — 三栏 UI

**目标**: 浏览器中可以浏览 workspace、查看 codoc、渲染 view、与 agent 对话。

### 6-1 Workspace 列表页

| 验收操作 | 预期结果 |
|---------|---------|
| 浏览器打开 `localhost:5173` | 显示 workspace 列表卡片（名称、路径、codoc 数量、build 状态 pill） |
| 点击卡片 | 跳转到该 workspace 的三栏首页 |
| 点击 [+ 添加]，输入本地路径 | 新 workspace 出现在列表中 |

### 6-2 Sidebar — Codoc 列表

| 验收操作 | 预期结果 |
|---------|---------|
| 进入 workspace 首页 | 左栏按文件树形展示所有 codoc，active 态高亮当前选中项 |
| 点击某个 codoc | 中栏 Detail Panel 加载该 codoc 的信息 |

### 6-3 Detail Panel

| 验收操作 | 预期结果 |
|---------|---------|
| 选中一个 codoc | 中栏显示三个区域：View（渲染）、Data（resolved JSON）、Node States（状态 + 上下游） |
| codoc 含 `view: stack > text + table` | View 区域正确渲染为垂直堆叠的文本和表格 |
| 节点状态为 error | Node States 区域红色显示错误原因 |

### 6-4 View 渲染器

| 验收操作 | 预期结果 |
|---------|---------|
| codoc view 使用 `stack` 布局嵌套 `text` + `markdown` + `table` | 页面正确渲染三个块，垂直堆叠 |
| 使用 `grid` 布局，`columns: 2` | 内容分为两列网格 |
| 使用 `tabs` 布局 | 显示标签页，点击切换内容 |
| 使用 `timeline` 布局 | 左侧装饰轨道 + 右侧卡片列表 |
| 使用 `section` 嵌套 | 带边框的卡片容器 |

### 6-5 Chat Panel

| 验收操作 | 预期结果 |
|---------|---------|
| 右栏 Chat Panel 可见 | 显示 agent picker 下拉 + 消息输入框 + 历史消息列表 |
| 输入消息并发送 | 流式显示 agent 回复（Vercel AI Elements 集成） |
| 选中某个 codoc 后发消息 | 该 codoc 自动 pin 为上下文，agent 回复基于该 codoc |
| 刷新页面 | 对话历史从后端恢复 |

### 6-6 实时事件

| 验收操作 | 预期结果 |
|---------|---------|
| 在终端手动编辑一个 `.codoc` 文件 | Web 页面自动刷新对应 codoc 的状态和数据（无需手动刷新） |
| agent 创建了新 codoc | Sidebar 立即出现新条目 |

### 6-7 响应式

| 验收操作 | 预期结果 |
|---------|---------|
| 浏览器窗口宽度 > 1200px | 三栏并排显示 |
| 浏览器窗口宽度 <= 1200px | 折叠为单栏垂直堆叠 |

---

## Phase 7: 场景 Agent 与扩展

**目标**: router-agent 分发机制就位，至少有一个垂直场景（RSS）端到端跑通。

### 7-1 Router Agent

| 验收操作 | 预期结果 |
|---------|---------|
| CLI `cobook chat` 不指定 agent | 默认路由到 base-agent |
| CLI `cobook chat --agent rss` | 路由到 RSS scene agent |
| 对话中途说 "帮我订阅一个 RSS feed" | router 根据 `shouldHandle` 自动切换到 RSS agent |
| 说一句跟 RSS 无关的话 | 继续沿用当前活跃场景，或 fallback 到 base-agent |

### 7-2 RSS Scene Agent

| 验收操作 | 预期结果 |
|---------|---------|
| 对 RSS agent 说 "订阅 https://example.com/feed.xml" | agent 创建 source codoc（type: rss），build 成功 |
| "看看最新的条目" | agent resolve RSS source，返回最新条目列表 |
| "把第 3 条整理成 codoc" | agent 创建新 codoc，引用 RSS source 中的对应条目 |

### 7-3 Session 持久化

| 验收操作 | 预期结果 |
|---------|---------|
| 与 RSS agent 对话后关闭 CLI | session state（如 `pendingStep`）持久化到数据库 |
| 重新 `cobook chat` | agent 恢复上次场景状态，能继续上下文 |

### 7-4 Web Agent Picker

| 验收操作 | 预期结果 |
|---------|---------|
| Web Chat Panel 下拉选择 agent | 列出所有 `cobook.yaml` 中启用的 agent，显示名称和描述 |
| 切换到 RSS agent | Chat Panel 加载该 agent 的 pinned codocs，对话上下文切换 |

---

## Phase 8: 文件监听与增量运行时

**目标**: workspace 文件变更自动触发增量 rebuild + resolve，CLI watch 模式和 Web SSE 推送。

### 8-1 CLI — watch

| 验收操作 | 预期结果 |
|---------|---------|
| 运行 `cobook watch` | 终端进入 watch 模式，显示 "Watching for changes..." |
| 在另一个终端编辑 `.codoc` 文件 | watch 终端流式输出：检测到变更 → rebuild → 受影响节点列表 → 新状态 |
| 删除一个被引用的 `.codoc` | watch 输出断引用错误 + 受影响的下游节点 |

### 8-2 SSE 事件推送

| 验收操作 | 预期结果 |
|---------|---------|
| `curl -N localhost:3100/api/events?workspaceId=xxx` | 建立 SSE 连接，终端等待 |
| 编辑 `.codoc` 文件 | SSE 推送事件：`{ kind: "change", path: "...", affectedNodes: [...] }` |
| Web 连接 SSE | 页面自动响应，无需手动刷新 |

### 8-3 值变化 vs 结构变化

| 验收操作 | 预期结果 |
|---------|---------|
| 修改 codoc 的 data 值（不改引用结构） | watch 输出 "value change"，仅触发 re-resolve，不重建 DAG |
| 给 codoc 新增一个 `$ref` 字段 | watch 输出 "structural change"，触发 DAG rebuild |

---

## 里程碑总览

| 里程碑 | 包含 Phase | 用户可做的事 |
|--------|-----------|-------------|
| **M0: 能编译** | Phase 0 | `pnpm turbo build` 零错误 |
| **M1: 能建图** | Phase 0-1 | 单元测试验证 parse → DAG → topo sort → cycle detect |
| **M2: 能持久化** | Phase 0-2 | 数据库表就位，repository CRUD 测试通过 |
| **M3: 能跑通** | Phase 0-3 | service 层端到端：open workspace → build → resolve |
| **M4: 能用 CLI** | Phase 0-4 | 终端完成 init → build → status → show → graph → resolve |
| **M5: 能对话** | Phase 0-5 | CLI chat 与 base-agent 对话，agent 能读写 codoc |
| **M6: 能看页面** | Phase 0-6 | 浏览器三栏 UI，codoc 浏览 + view 渲染 + 在线 chat |
| **M7: 能扩展** | Phase 0-7 | 场景 agent 路由 + RSS 端到端 |
| **M8: 能实时** | Phase 0-8 | 文件变更自动触发增量更新，CLI watch + Web SSE |
