# CoDoc Agent 架构落地计划

基于 [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md) 的设计，对照现有实现制定的分阶段落地方案。

---

## 现状与目标差距

| 维度 | 现状 | 目标 |
|------|------|------|
| Agent 层级 | 扁平：codoc-agent / summary / info-check / polish 都是 chat bus 里的 peer | 两层：Codoc Agent（基础设施）+ 场景 Agent（领域） |
| Intent 生命周期 | 嵌入 chat message，proposed / confirmed / rejected 三态 | 独立队列，5 态主流程 + 异常标记 |
| 写入权 | 任何 agent 都能 propose 结构化 intent（直接包含 field/value） | 场景 agent 只产出 NL 意图，codoc agent 唯一写入 |
| Schema 角色 | codoc-agent system prompt 硬编码能力 | Schema 是共享契约，被两层 agent 各读一次 |
| Agent 激活 | daemon / on-mention 触发，无"注册但未激活"概念 | 场景 agent 按需激活，codoc agent 常驻 |
| 消费侧控制 | 无 | debounce / merge / rate-limit |
| NL 路由 | chat bus keyword 匹配（TriggerFilter） | 语义路由 + 消歧交互 |
| 信任层级 | 所有 intent 统一需要用户 confirm | 可配置 trusted agent，跳过审阅 |

---

## Phase 0：Intent Queue 独立化

> 把 intent 从 chat message 中抽出来，建立独立的意图队列。这是整个两层架构的解耦基石。

### 工作项

1. **定义 `IntentRecord` 类型**
   - `id`、`source`（哪个 agent）、`target`（docId + field）、`content`（NL 描述）、`payload`（结构化数据，向后兼容）
   - 状态机：`pending → previewed → confirmed → executed → propagated`，加 `rejected` / `failed`
   - 异常标记：`conflicted`、`stale`（可叠加 flag）

2. **实现 `IntentQueue` 模块**
   - 入队（enqueue）、状态流转、查询、订阅变更
   - 消费侧：先实现 debounce，merge / rate-limit 留 stub

3. **迁移现有 intent 流**
   - `executeCodocIntent` 改为从队列消费
   - chat message 中的 intent 保留（展示用），执行走队列
   - SSE 事件扩展为 `intent-queue` 事件

4. **基础 UI**
   - WorkspaceShell 加 badge 角标（N 条 pending）
   - 点开展开意图列表：preview / confirm / reject

### 不做

不改 agent 协议，不改 prompt，不拆 codoc-agent。只搬 intent 的"住所"。

### 验证标准

现有 create-codoc / write-field 等操作全部经过 intent queue 流转，用户可在 queue UI 中审阅和确认。

---

## Phase 1：Codoc Agent 纯化为基础设施层

> Codoc Agent 变成纯粹的 `(schema, current_data, NL_intent) → data_patch` 执行器。

### 工作项

1. **Schema 读取 API**
   - `workspace.getDocSchema(docId)` → codoc 的 type 定义
   - `workspace.getDocData(docId)` → 当前 data 快照
   - 这两个 API 是 codoc agent 的全部输入来源

2. **重写 codoc-agent prompt**
   - 移除所有领域知识（Claude log ingestion、RSS 等）
   - System prompt 只描述：你是 schema-aware 执行器，给定 schema + data + NL intent，输出 data_patch
   - 输出格式统一为 `data_patch`

3. **Codoc Agent 变为 intent queue 消费者**
   - 不再由 chat bus message 触发
   - 监听 queue 中 `confirmed` 状态的意图，消费执行
   - 执行结果写回 queue（`executed` / `failed`）

4. **保留 chat 直接操作的快捷路径**
   - 用户在 chat 中说"把 title 改成 xxx"仍可用
   - 走 queue → codoc agent 完整链路（chat 充当"内置场景 agent"）

### 验证标准

codoc-agent system prompt 中零领域知识。给它任意 codoc 的 schema + NL intent，都能产出合法 data_patch。

---

## Phase 2：场景 Agent 协议 + 迁移

> 定义场景 Agent 标准接口，将现有 agent 迁移为场景 agent。

### 工作项

1. **定义 `SceneAgent` 接口**
   ```typescript
   interface SceneAgent {
     id: string;
     name: string;
     description: string;
     targetCodocKinds?: string[];

     handle(context: SceneAgentContext): Promise<IntentProposal[]>;
   }

   interface IntentProposal {
     targetDocId: string;
     targetField?: string;
     naturalLanguageIntent: string;
   }
   ```

2. **SceneAgent 注册表**
   - `registerSceneAgent()` / `listSceneAgents()` / `getSceneAgent()`
   - 每个场景 agent 有激活状态（默认未激活）

3. **迁移现有 agents**
   - `summary-agent` → 读 schema，产出"为 field X 生成摘要"的 NL 意图
   - `info-check-agent` → 产出"校验 field X 的信息准确性"的 NL 意图
   - `polish-agent` → 产出"润色 field X 的表达"的 NL 意图
   - Claude log ingestion → 产出"从路径 P 导入 session 数据"的 NL 意图

4. **场景 agent → intent queue 连接**
   - `handle()` 返回 `IntentProposal[]`
   - 系统自动 enqueue 到 intent queue（status: pending）

### 验证标准

summary-agent 通过场景 agent 协议产出 NL 意图 → 入队 → 用户 confirm → codoc agent 消费执行 → data 更新。完整链路跑通。

---

## Phase 3：Agent 激活模型

> 实现常驻 + 按需激活的双模型。

### 工作项

1. **Codoc Agent 常驻化**
   - 从 chat bus daemon 改为独立 queue consumer
   - 永远在线，监听 intent queue

2. **场景 Agent 激活管理**
   - workspace 配置中记录已注册场景 agents 及激活状态
   - `activateSceneAgent(id)` / `deactivateSceneAgent(id)`

3. **显式激活 UI**
   - 右侧 ParticipantsPanel → Agent Panel
   - 列出所有已注册场景 agents，toggle 激活/停用

4. **Chat 中 @mention 激活**
   - 保留 on-mention 能力作为激活场景 agent 的方式

### 验证标准

用户在 Agent Panel 中看到所有场景 agent，手动激活后该 agent 开始响应消息并产出意图。

---

## Phase 4：NL 路由 + 信任配置

> 用户无需手动选 agent，直接说需求系统自动路由。加 trusted agent 实现全自动化。

### 工作项

1. **NL 路由器**
   - 输入：用户消息 + 已注册场景 agents 的 description
   - 输出：匹配的 agent(s) 或"需消歧"
   - 实现：LLM-based 分类
   - 路由失败 → chat 交互式消歧（展示候选 agents）

2. **Trusted Agent 配置**
   - 每个场景 agent 可标记 `trusted: boolean`
   - Trusted intent 跳过 pending/previewed，直接 confirmed → executed
   - Agent Panel 中增加 trust toggle

3. **Intent Queue 增强**
   - Conflict 检测：pending 期间目标 field 被修改 → 标记 `conflicted`
   - Stale 检测：长时间未审阅 + 上游变更 → 标记 `stale`
   - Queue UI 展示标记，用户决定继续或放弃

### 验证标准

用户说"帮我把这篇文章翻译成英文" → 自动路由到翻译 agent → 产出意图 → trusted 则自动执行，否则等待审阅。

---

## 依赖关系

```
Phase 0: Intent Queue 独立化
    ↓
Phase 1: Codoc Agent 纯化         ← 依赖 queue 作为消费源
    ↓
Phase 2: 场景 Agent 协议           ← 依赖 queue 作为生产目标 + codoc agent 作为执行器
    ↓
Phase 3: 激活模型                  ← 依赖场景 agent 注册表
    ↓
Phase 4: NL 路由 + 信任            ← 依赖激活模型 + intent queue 完整生命周期
```

每个 phase 结束后系统可用：Phase 0 现有功能不变只是 intent 有了独立的家；Phase 1 codoc agent 更通用；Phase 2 两层架构跑通；Phase 3/4 渐进式体验增强。
