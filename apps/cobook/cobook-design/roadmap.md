# Cobook 实现 Roadmap

## 目标目录结构

按领域划分，不按作用划分。每个领域内部自包含 types、逻辑、组件（如有）。

```
src/
  chat/                          # Chat Ability — 可复用的多参与者对话能力层
    types.ts                     # Message, Participant, Intent, ResourceRef, ResponseMode, etc.
    session.ts                   # Session, MessageTree, branch 操作
    context.ts                   # ContextSource, ContextRequirement, assembly 逻辑
    bus.ts                       # Chat Bus：消息路由、触发过滤、响应链、防循环
    events.ts                    # ChatEvents 定义 + EventEmitter（per session）
    thread.ts                    # ThreadLink, ThreadAnchor, ThreadConfig, thread 生命周期
    index.ts                     # createChatAbility() → ChatAbility 接口
    __tests__/

  codoc-use/                     # Codoc Use — core 适配层
    resource.ts                  # codoc → ResourceRef 注册、listCodocResources()
    context.ts                   # codoc-snapshot ContextSource 工厂 + 序列化
    intent.ts                    # CodocIntentKind 定义 + executeCodocIntent()
    events.ts                    # workspace.onFieldChange → chat 系统消息桥接
    index.ts                     # initCodocUse(workspace, chat, sessionId)
    __tests__/

  agents/                        # Agents — 参与者定义 + 执行器
    types.ts                     # AgentExecutor 接口、AssembledContext
    codoc-agent.ts               # Participant 定义 + executor
    summary-agent.ts
    info-check-agent.ts
    polish-agent.ts
    register.ts                  # registerPresetAgents(chat, sessionId)
    __tests__/

  workspace/                     # Cobook Workspace — 应用容器层
    components/
      WorkspaceShell.tsx         # 三栏布局 shell（重构自现有）
      ChatArea.tsx               # 消息流 + 输入（重构自 ChatPanel）
      MessageRow.tsx             # 单条消息渲染（从 ChatPanel 抽出）
      IntentCard.tsx             # intent 操作卡片（替代 WritePreviewCard）
      ResourceCard.tsx           # 消息内 codoc 卡片（重命名自 CodocCard）
      ContextBar.tsx             # session active references 栏（从 ChatPanel 抽出）
      ChatInput.tsx              # 输入框（重构自现有）
      ResourcesPanel.tsx         # 左栏资源列表（重构自 CodocList）
      ParticipantsPanel.tsx      # 右栏参与者（重构自 AgentsPanel）
      DagGraphView.tsx           # 图谱视图（原样迁移）
      CodataValue.tsx            # 字段值展示（原样迁移）
      mdx-components.tsx         # MDX 渲染（原样迁移）
    hooks/
      use-session.ts             # useSyncExternalStore 接 Chat Ability Session
      use-workspace.ts           # workspace 初始化 + doc 列表（迁移自现有）
      use-field-snapshot.ts      # 字段快照订阅（原样迁移）
    api/                         # Next.js API routes
      _workspace.ts              # workspace 单例（不变）
      workspace/route.ts         # GET /api/workspace（不变）
      docs/                      # codoc CRUD 路由（不变）
      events/route.ts            # SSE 事件推送（不变）
      chat/route.ts              # 新的消息处理路由（agent 路由 + 自由聊天合并）
    workspace-store.ts           # WorkspaceStore（迁移自 lib/，不变）
    api-client.ts                # workspace HTTP 客户端（从 lib/api.ts 提取 workspace 部分）
    state.ts                     # app 级 UI 状态（active references 等）

  shared/                        # 跨领域共享
    ui/                          # shadcn 组件（原样迁移，7 个文件）
    types.ts                     # HTTP 契约类型（迁移自 lib/types.ts，不变）
    ai.ts                        # LLM client 封装（迁移自 lib/ai.ts，不变）
    utils.ts                     # cn() 等工具（迁移自 lib/utils.ts，不变）

  app/                           # Next.js app shell（不变）
    layout.tsx
    page.tsx
    globals.css
```

**从现有目录到新目录的映射：**

| 现有文件 | 去向 | 动作 |
|---------|------|------|
| `lib/chat-store.ts` | — | 删除，被 `chat/session.ts` 替代 |
| `lib/agents.ts` | — | 删除，被 `agents/*.ts` 替代 |
| `lib/commands.ts` | — | 删除，command 不再是独立概念 |
| `lib/types.ts` | `shared/types.ts` | 迁移 |
| `lib/utils.ts` | `shared/utils.ts` | 迁移 |
| `lib/ai.ts` | `shared/ai.ts` | 迁移 |
| `lib/workspace-store.ts` | `workspace/workspace-store.ts` | 迁移 |
| `lib/api.ts` | `workspace/api-client.ts` | 提取 workspace 部分，删除 chat/agent streaming |
| `app/api/_context.ts` | — | 删除，被 `chat/context.ts` + `codoc-use/context.ts` 替代 |
| `app/api/agent/route.ts` | — | 删除，被 `workspace/api/chat/route.ts` 替代 |
| `app/api/chat/route.ts` | — | 删除，同上 |
| `app/api/_workspace.ts` | `workspace/api/_workspace.ts` | 迁移 |
| `app/api/docs/**` | `workspace/api/docs/**` | 迁移 |
| `app/api/events/route.ts` | `workspace/api/events/route.ts` | 迁移 |
| `app/api/workspace/route.ts` | `workspace/api/workspace/route.ts` | 迁移 |
| `components/ui/*` | `shared/ui/*` | 迁移 |
| `components/WorkspaceShell.tsx` | `workspace/components/WorkspaceShell.tsx` | 迁移后重构 |
| `components/ChatPanel.tsx` | `workspace/components/ChatArea.tsx` | 重构拆分 |
| `components/ChatInput.tsx` | `workspace/components/ChatInput.tsx` | 迁移后重构 |
| `components/CodocList.tsx` | `workspace/components/ResourcesPanel.tsx` | 重命名+重构 |
| `components/AgentsPanel.tsx` | `workspace/components/ParticipantsPanel.tsx` | 重命名+重构 |
| `components/CodocCard.tsx` | `workspace/components/ResourceCard.tsx` | 重命名 |
| `components/DagGraphView.tsx` | `workspace/components/DagGraphView.tsx` | 迁移 |
| `components/CodataValue.tsx` | `workspace/components/CodataValue.tsx` | 迁移 |
| `components/mdx-components.tsx` | `workspace/components/mdx-components.tsx` | 迁移 |
| `hooks/use-workspace.ts` | `workspace/hooks/use-workspace.ts` | 迁移 |
| `hooks/use-field-snapshot.ts` | `workspace/hooks/use-field-snapshot.ts` | 迁移 |
| `hooks/use-current-doc.ts` | — | 删除，由 session reference 管理替代 |

注：`app/layout.tsx`、`app/page.tsx`、`app/globals.css` 不动。`app/api/` 下的路由文件物理位置必须留在 `app/api/` 下以满足 Next.js 约定，但逻辑实现抽到 `workspace/api/` 中，route 文件只做薄转发。

---

## 分阶段实施

### Phase 0：清理 + 目录重构

**目标**：建立新目录结构，删除废弃代码，迁移可复用文件。此阶段结束后旧的 `lib/`、`components/`、`hooks/` 目录清空删除。

**步骤：**

1. 创建新目录骨架：`chat/`、`codoc-use/`、`agents/`、`workspace/`、`shared/`
2. 迁移不变文件（shared/ui、shared/types、shared/ai、shared/utils）
3. 迁移 workspace 相关文件（workspace-store、api routes、hooks）
4. 迁移 UI 组件到 `workspace/components/`（暂保持原实现，只改 import 路径）
5. 删除废弃文件：`lib/chat-store.ts`、`lib/agents.ts`、`lib/commands.ts`、`app/api/_context.ts`、`app/api/agent/route.ts`、`app/api/chat/route.ts`、`hooks/use-current-doc.ts`
6. 从 `lib/api.ts` 提取 workspace API 部分到 `workspace/api-client.ts`，删除原文件
7. 更新所有 import 路径，确认编译通过
8. 此时 app 编译通过但 chat 功能不可用（旧 ChatStore 已删），这是预期状态

**产出**：新目录结构就位，旧代码清理完毕，workspace/docs 功能正常。

---

### Phase 1：Chat Ability — 核心模型 + Session

**目标**：实现 Chat Ability 的核心数据结构和基本操作，不含 LLM 调用。

**文件：**
- `chat/types.ts` — Message, Participant, ParticipantRef, Intent, ResourceRef, ResponseMode, TriggerFilter, ResponseAction
- `chat/session.ts` — Session, MessageTree, MessageNode, addMessage, getActiveBranch, branchAt, switchBranch
- `chat/events.ts` — ChatEvents 接口, per-session EventEmitter, onMessage/onIntentStatusChange/onBranchSwitch
- `chat/index.ts` — createChatAbility() 返回 ChatAbility 接口的基本骨架（createSession, sendMessage, registerParticipant, updateIntentStatus, branch 操作）

**验证**：单元测试覆盖：
- 创建 session、注册 participant
- 发送消息、构建 message tree
- 分支创建和切换
- Intent 状态变更 + 事件触发

**不含**：上下文组装、消息路由、thread。

---

### Phase 2：Chat Ability — 上下文 + 路由

**目标**：实现上下文管理和消息路由机制。

**文件：**
- `chat/context.ts` — ContextSource, ContextRequirement, ContextData, ContextSourceFactory, assembleContext()（按 agent 的 requirements 从 session 的 sources 中组装）
- `chat/bus.ts` — 消息路由逻辑：on-mention 匹配、daemon TriggerFilter 过滤、响应链深度限制 + 去重 + 冷却
- 更新 `chat/index.ts` — 补充 registerContextSource, registerContextSourceFactory, getIntent, 路由接入

**验证**：单元测试覆盖：
- 注册 ContextSource + factory，按 requirement 组装
- token 预算裁剪
- on-mention 路由触发正确的 agent
- daemon filter 规则匹配
- 响应链深度限制和去重

---

### Phase 3：Codoc Use

**目标**：将 CoDoc Core 适配为 Chat Ability 原语。

**文件：**
- `codoc-use/resource.ts` — listCodocResources(workspace) → ResourceRef[]
- `codoc-use/context.ts` — createCodocContextSource(workspace, docId), serializeCodocForLLM()
- `codoc-use/intent.ts` — CodocIntentKind 类型, executeCodocIntent(workspace, intent)
- `codoc-use/events.ts` — bridgeWorkspaceEvents(workspace, chat, sessionId)
- `codoc-use/index.ts` — initCodocUse(workspace, chat, sessionId) 一次性注入

**验证**：集成测试：
- 注册 codoc-snapshot ContextSource factory → resolve 出正确的序列化文本
- confirmed intent → workspace 字段被正确写入
- workspace 字段变更 → chat session 收到系统消息

---

### Phase 4：Agents

**目标**：定义 4 个预置 agent 的 Participant + AgentExecutor。

**文件：**
- `agents/types.ts` — AgentExecutor 接口 { execute(context, triggerMessage) → ResponseAction }
- `agents/codoc-agent.ts` — Participant 定义（daemon + filter）+ executor（system prompt + LLM）
- `agents/summary-agent.ts` — Participant + executor
- `agents/info-check-agent.ts` — Participant + executor
- `agents/polish-agent.ts` — Participant + executor
- `agents/register.ts` — registerPresetAgents(chat, sessionId)：注册 participant + 绑定 executor

**验证**：
- 各 agent 的 Participant 定义符合设计（contextRequirements, responseMode）
- executor 接收 assembledContext → 调用 LLM → 返回 reply ResponseAction
- codoc-agent executor 能产出带 intent 的消息
- summary/info-check/polish executor 在有 codoc-snapshot 时能产出 write intent

**API 路由**：
- 新建 `workspace/api/chat/route.ts`：接收消息 → 走 Chat Ability 的 sendMessage → 触发 agent → 流式返回响应。这是旧 `api/chat/route.ts` 和 `api/agent/route.ts` 的合并替代。

---

### Phase 5：Workspace UI 重构

**目标**：将 UI 组件接入新的 Chat Ability + Codoc Use + Agents。

**5a: 基础接入**
- `workspace/hooks/use-session.ts`：useSyncExternalStore 接 Chat Ability Session 事件
- `workspace/state.ts`：app 级状态（active references）
- 重构 `WorkspaceShell.tsx`：启动流程按设计 5 步走（workspace → chat → codoc-use → agents → UI）

**5b: ChatArea**
- 重构 `ChatArea.tsx`（原 ChatPanel）：
  - 消息渲染从 `role: user|assistant` 改为 `sender: ParticipantRef`，显示具名 agent
  - 抽出 `MessageRow.tsx`、`ContextBar.tsx`
- 新建 `IntentCard.tsx`：替代 WritePreviewCard，通用的 intent 操作卡片（proposed/confirmed/rejected 状态）
- 重构 `ChatInput.tsx`：@mention 支持 participant + resource 两类，/command 映射为 @mention

**5c: 侧栏**
- 重构 `ResourcesPanel.tsx`（原 CodocList）：点击 codoc → 通过 Codoc Use 注册 ContextSource + ResourceRef
- 重构 `ParticipantsPanel.tsx`（原 AgentsPanel）：显示 agent 状态（idle/thinking/responding）、daemon 开关

**验证**：端到端手动验证：
- 左栏 reference codoc → context bar 出现 → agent 能拿到上下文
- 输入框 @summary-agent → 触发 summary → 结果带 intent card
- intent confirm → codoc 字段写入 → workspace 事件 → 系统消息出现
- participants panel 显示 agent 状态变化

---

### Phase 6（延后）：Thread + Branch UI

Thread 和 Branch 的运行时在 Phase 1-2 已实现数据结构，但 UI 可延后。

- `chat/thread.ts` — ThreadLink, ThreadAnchor, 生命周期管理
- 更新 `chat/index.ts` — openThread, resolveThread, abandonThread, getThread
- Thread UI 组件
- Branch 切换 UI

---

## 阶段依赖图

```
Phase 0  清理 + 目录重构
  │
  ▼
Phase 1  Chat: 模型 + Session
  │
  ▼
Phase 2  Chat: 上下文 + 路由
  │
  ├──────────────┐
  ▼              ▼
Phase 3        Phase 4（依赖 Phase 3 的 intent 类型）
Codoc Use      Agents
  │              │
  └──────┬───────┘
         ▼
Phase 5  Workspace UI
         │
         ▼
Phase 6  Thread + Branch UI（延后）
```

Phase 3 和 Phase 4 有轻度依赖（agents 消费 codoc-use 的 intent 类型），建议 3 先于 4，但实现周期可以重叠。
