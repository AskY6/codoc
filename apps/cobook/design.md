# M5-core 与 Cobook MVP 设计文档

原 M5（Workspace）拆为两层：core 中的逻辑 Workspace（M5-core）和基于逻辑 Workspace 的知识管理应用（Cobook）。拆分的本质是 infrastructure 和 application 分离。

---

## 一、抽象理念

### 1.1 为什么知识管理需要 CoDoc

现有知识管理工具（Notion、Obsidian、NotebookLM）的共同天花板是：**知识是活的，但工具把它当成死的。** 文档之间的链接只是导航快捷方式，不是依赖边。一份报告引用的数据源变了，报告不知道自己过期了，更不知道哪些结论因此失效。"更新"是人的责任。

NotebookLM 往前迈了一步——用 LLM 理解源材料，支持对话式消费。但它的理解是快照式的：上传时理解一次，源材料变了不会自动失效。它是一个更智能的阅读器，不是一个计算系统。

CoDoc 的核心等式 `observe(codata) → force(deps) → value → propagate(dependents)` 给知识管理带来了根本不同的基础设施：知识单元不是文档，是 codata——有 schema、有依赖、有惰性求值的值。知识之间的引用不是链接，是计算图的边——上游变了，下游自动标脏。

### 1.2 Cobook 的定位

Cobook 不是"CoDoc 的文件浏览器"，是一个**以对话为中心、以 codoc 为知识资产、以 agent 为能力层的团队知识工作台**。

三条基础决策：

1. **对话是主界面。** 用户的主要动作是在 chat 中思考和操作，不是在文件列表里导航。Codoc 是 chat 的上下文和产出物。
2. **Codoc 是知识资产，不是被打开的文档。** Codoc 像上下文一样被 reference 进 chat，而不是像文件一样被双击打开。它的 schema 让 agent 理解知识结构，它的值让 agent 读取知识内容。
3. **Agent 是能力层，不是对话方。** Agent 不是聊天机器人，是执行特定知识操作的工具——总结、校验、润色、生成。用户通过 chat 调度 agent，agent 的产出经人类审阅后写入 codoc。

### 1.3 与 CoDoc core 的关系

Cobook 是 CoDoc 的第一个应用层产品，不是 core 的一部分。

CoDoc core 提供的是：codata 内核、relation engine、render engine、loader 体系、跨文档引用、逻辑 workspace。这些能力不知道自己被用来做知识管理。

Cobook 消费这些能力，但不穿透它们。Cobook 通过 Workspace API 与 core 交互，不直接操作 codata tree 或 relation engine 内部。这个边界是硬约束——Cobook 的任何需求如果需要穿透 API 边界，说明 core 的 API 设计不够，应该扩展 API，而不是让 Cobook 绕过去。

### 1.4 知识管理的上限

沿着 CoDoc 的模型推到极致：**一个组织的知识不是一堆文档，而是一张活的计算图。** 节点是各种粒度的知识单元（原始数据、事实、推导、洞察、决策），边是字段级依赖。整张图是响应式的——任何输入端的变化沿边传播，所有受影响的节点自动失效，观察时按需重算。

这个上限受两个因素约束：知识的结构化程度（非结构化知识无法参与计算图）和人类的信任边界（推导链太深时人类难以审阅）。Cobook 不试图一步到达上限，而是从最小可用的形态开始——chat + codoc + agent。

---

## 二、产品设计

### 2.1 核心交互模型

用户打开 Cobook，看到三栏布局：

- **左侧：Codoc 列表。** Workspace 内所有 codoc 的索引。支持浏览和搜索。每个 codoc 显示名称和 schema 摘要。用户从这里将 codoc reference 进 chat。
- **中间：Chat 区域。** 树状对话结构，是用户的主要工作区。用户在这里 reference codoc、调用 agent、审阅生成结果、确认写入。Chat 是全局的，感知整个 workspace 的 codoc。
- **右侧：Agents 面板。** 预置的能力工具箱。每个 agent 有明确的功能定义和输入/输出 schema。用户在 chat 中调用 agent 对被 reference 的 codoc 执行操作。

### 2.2 Chat

Chat 是 Cobook 的核心界面，不是辅助功能。

**树状结构。** Chat 不是线性的消息流。用户可以在任意对话节点分叉出新分支，探索不同方向而不丢失之前的上下文。每个分支继承父节点的 codoc reference 和对话历史。

**Codoc 作为上下文。** 用户在 chat 中 reference 一个或多个 codoc，它们的 schema 和值自动进入对话上下文。Agent 可以读取被 reference 的 codoc 的字段值，也可以生成新值写回。Reference 的粒度可以是整个 codoc，也可以是特定字段。

**三种核心动作：**

- **Reference**：将 codoc 纳入 chat 上下文。Agent 获得该 codoc 的 schema 和值的读取权。
- **Review**：在 chat 中查看被 reference 的 codoc 的渲染结果。复用 codoc 自身的 MDX render engine，不另起一套渲染。
- **Generate**：调用 agent 基于当前上下文生成新内容。生成结果先在 chat 中预览，用户确认后写入目标 codoc 的指定字段。

**先预览再写入。** Agent 生成的内容不直接写入 codoc，而是在 chat 中以预览形态展示。用户审阅后，显式确认"写入"动作才真正修改 codoc 的 data。这保持了人类作为"判断者"的角色——与 CoDoc 设计文档中"Agent 写，人类 Review"的原则一致。

### 2.3 Agents

MVP 预置固定的 agent 集合，后续开放自定义。

每个 agent 是一个功能明确的知识操作单元：

- **Summary Agent**：对被 reference 的 codoc 生成结构化摘要。输出符合目标 codoc 的 schema 约束。
- **Information Check Agent**：校验 codoc 中字段值的一致性、时效性、引用的有效性。输出是校验报告——哪些字段有问题、问题是什么、建议的修正。
- **文本润色 Agent**：对 codoc 中的文本字段进行润色。保持 schema 结构不变，只改善文本质量。

Agent 的共性设计原则：

- **输入是被 reference 的 codoc 字段。** Agent 通过 codoc 的 schema 理解输入结构，通过 observe 读取字段值。
- **输出受 schema 约束。** Agent 的生成结果必须符合目标 codoc 的 type 定义。这是 CoDoc AI 友好性的直接应用——schema 是 agent 的 action space。
- **不直接写入。** Agent 产出预览结果，用户确认后由 Cobook 执行写入。Agent 本身没有 codoc 的写权限。

### 2.4 Codoc 列表与图谱视图

**Codoc 列表（左侧栏）** 是用户的知识资产索引。每个条目显示 codoc 名称和 schema 摘要（顶层字段名和类型）。这是 codata "接口先于内容"在产品侧的体现——用户先看知识的结构，不需要加载内容。

列表支持：按名称/schema 关键词搜索，将 codoc reference 进当前 chat（拖拽或点击），在 chat 中 review 某个 codoc 的渲染结果。

**图谱视图** 是辅助工具，不是主界面。从 codoc 列表可以切换到图谱视图，查看 workspace 内所有 codoc 的依赖关系全景。用户偶尔用它理解知识网络的全局结构，但日常工作在 chat 中完成。

### 2.5 Codoc 渲染的复用

知识节点的内容渲染复用 codoc 自身的 MDX render engine，Cobook 不另起一套 UI。

Chat 中 review 一个 codoc 时，渲染走标准的 observe → force → MDX render 流程。Cobook 在渲染结果之上叠加元信息（staleness 标记、依赖关系提示）作为 overlay，不侵入 codoc 的 view 定义。对知识呈现质量的需求转化为 core component registry 的组件丰富度——健康的压力方向，推动 core 变强而不是让 Cobook 绕开 core。

### 2.6 不在 MVP 中做的事

- 自定义 agent（MVP 只提供预置 agent）
- 实时协同编辑
- 模板系统
- 推导链的完整审计日志
- 非结构化文档的结构化摄入（所有知识以 codoc 原生创建）
- 权限控制

---

## 三、技术设计

### 3.1 M5-core：逻辑 Workspace

M5-core 是 core 的一部分，职责是让多棵 codata tree 形成可管理的依赖网络。它向上暴露通用能力，不绑定任何应用语义。

#### 3.1.1 交付

**a. Workspace 索引**

一个 workspace 目录下所有 `.codoc` 的注册表。启动时扫描，变更时增量更新。

- 枚举 workspace 内所有 `.codoc`
- 读取每个 `.codoc` 的 meta 层（type + data schema），不 force 值
- 从 meta 中提取所有 `[[external]]` 引用声明

索引是轻量的内存结构，不是数据库。v1 不需要持久化——重启时重新扫描。

**b. 全局依赖图**

从索引中聚合所有跨文档引用，构建 workspace 级 DAG。

- 节点粒度：`docId + fieldPath`
- 边来源：`[[external.codoc]].data.field` 引用关系
- v1 中查询时从索引构建，不常驻内存
- 循环检测复用 M1 的算法，扩展到跨文档场景

**c. 跨文档标脏传播**

已加载 codoc 之间的变更传播。

- A 的字段值变了 → 沿全局 DAG 标脏所有下游字段（包括其他已加载 codoc 中的字段）
- 未加载的 codoc 不主动标脏。加载时通过上游字段的 generation counter 发现输入已过期，触发首次 force
- 标脏只做失效标记，不触发 force。Force 仍由 observe 驱动，保持 codata 惰性语义

**d. 文档生命周期管理**

- 按需加载：observe 到跨文档引用时，加载目标 codoc
- 未加载文档以 proxy 节点存在于全局图中
- v1 不做卸载策略——加载后常驻，直到 workspace 关闭

#### 3.1.2 Workspace API

Workspace 向应用层暴露四个能力：

```typescript
interface Workspace {
  // 索引：枚举所有 codoc 的 meta
  listDocs(): DocMeta[]

  // 全局图：字段级依赖关系
  getDependencyGraph(): Graph<FieldAddress, DepEdge>

  // 文档加载：返回可 observe/write 的 codoc 实例
  loadDoc(docId: string): CodocRuntime

  // 变更订阅：workspace 级字段变更通知
  onFieldChange(callback: (event: WorkspaceChangeEvent) => void): Unsubscribe
}
```

`DocMeta` 只包含 type（JSON Schema）和 data 的 schema 层信息（字段名、类型、描述、引用声明），不包含值。

`CodocRuntime` 暴露字段级的读写接口：observe 读值（codata 的标准能力），write 写入 input 字段（仅 input 字段可写，derived 字段不可直接写入——复用断裂点 5 的 input/derived 区分）。Cobook 的 agent 通过这个接口读取 codoc 内容和写入生成结果。

#### 3.1.3 不在 v1 中做的事

- 常驻内存的增量全局图维护（查询时构建够用）
- 未加载文档的标脏持久化（加载时检查够用）
- 事务性并发控制（last-write-wins + 标脏收敛够用）
- 冷启动优化（全量扫描够用）
- Workspace 外部依赖的边界处理（v1 只支持 workspace 内引用）

### 3.2 Cobook 应用层

Cobook 是逻辑 Workspace 之上的薄壳。核心职责是三件事：编排 chat 交互、调度 agent 执行、管理 codoc reference 的上下文。

#### 3.2.1 三栏架构

```
┌──────────────┬─────────────────────────┬──────────────┐
│              │                         │              │
│  Codoc 列表   │       Chat 区域          │  Agents 面板  │
│              │                         │              │
│  - 索引浏览    │  - 树状对话              │  - 预置 agent │
│  - 搜索       │  - reference codoc      │  - 功能描述   │
│  - → chat    │  - review (MDX render)  │  - → chat    │
│              │  - generate → preview   │              │
│              │    → confirm → write    │              │
│              │                         │              │
└──────────────┴─────────────────────────┴──────────────┘
```

#### 3.2.2 Chat 引擎

Chat 是 Cobook 自有的组件，不复用 codoc 的 render engine（render engine 只用于 codoc 内容的渲染）。

- **树状对话模型**：每个对话节点包含用户消息、agent 响应、被 reference 的 codoc 列表。子节点继承父节点的 codoc reference 上下文。
- **Codoc reference 管理**：维护当前对话分支中被 reference 的 codoc 集合。Reference 一个 codoc 时，通过 `workspace.loadDoc()` 加载它，读取 schema 和值，注入 agent 的 context。
- **生成-预览-确认流程**：agent 输出 → chat 中展示预览（包含目标 codoc、目标字段、新值）→ 用户确认 → 通过 `CodocRuntime.write()` 写入 → 触发标脏传播。

#### 3.2.3 Agent 执行层

每个预置 agent 本质上是一个配置好的 LLM 调用模板：

- **System prompt**：定义 agent 的角色和能力边界
- **Input schema**：从被 reference 的 codoc 中读取哪些字段
- **Output schema**：生成结果的结构，必须符合目标 codoc 的 type 约束
- **执行**：读取 input → 构造 prompt → 调用 LLM → 校验 output 是否符合 schema → 返回预览

Agent 执行层不直接依赖 CoDoc core——它通过 Workspace API 获取 codoc 的 schema 和值，通过标准的 LLM Structured Output 生成结果。Agent 是 Cobook 应用层的组件，不是 core 的一部分。

#### 3.2.4 渲染复用

Chat 中 review 一个 codoc 时：

1. Cobook 调用 `workspace.loadDoc(docId)` 获取 `CodocRuntime`
2. 将 `CodocRuntime` 交给 core 的 render engine
3. Render engine 走标准的 observe → force → MDX render 流程
4. Cobook 在渲染结果外层包裹 overlay（staleness 标记等）

Cobook 不介入渲染过程本身。

#### 3.2.5 技术栈

- Chat UI：React + 树状对话组件
- Codoc 渲染：复用 core 的 render engine（MDX + React）
- Agent 执行：LLM API 调用 + JSON Schema validation
- 状态管理：不引入额外框架。Codoc 状态在 CodocRuntime 中，chat 状态在 Cobook 本地
- 图谱视图（辅助）：D3 或同类图渲染库

---

## 四、Roadmap

### 里程碑依赖关系

```
M0 (codata 内核)
 └→ M1 (relation engine)
     └→ M2 (render + 单文档) ← Core MVP
         └→ M3 (扩展 loader)
             └→ M4 (跨文档引用)
                 └→ M5-core (逻辑 workspace)
                     └→ Cobook MVP ← 应用 MVP
```

M0–M4 不变。原 M5 拆为 M5-core 和 Cobook，严格串行依赖。

### M5-core

**交付：** 逻辑 Workspace——多棵 codata tree 的依赖网络管理

- Workspace 索引（枚举、meta 读取、引用提取）
- 全局依赖图（查询时构建、跨文档 DAG）
- 跨文档标脏传播（已加载文档间、generation counter）
- Workspace API（listDocs、getDependencyGraph、loadDoc、onFieldChange）

**依赖：** M4

**验证标准：** 一个 workspace 内 5+ 个互相引用的 `.codoc`，通过 Workspace API 获取全局依赖图且结构正确，修改上游字段后下游已加载 codoc 自动标脏。

### Cobook MVP

**交付：** 以对话为中心的团队知识工作台

- 三栏布局（codoc 列表 + chat + agents 面板）
- 树状 chat（分支、继承上下文）
- Codoc reference 机制（纳入 chat 上下文、schema + 值注入 agent context）
- Review 动作（chat 内嵌 codoc 的 MDX 渲染）
- Generate 动作（agent 调用 → 预览 → 确认 → 写入）
- 预置 agent（summary、information check、文本润色）

**依赖：** M5-core

**验证标准：** 一个 workspace 内 5+ 个互相引用的 codoc。用户在 Cobook 中：

1. 左侧看到所有 codoc 的列表和 schema 摘要
2. 将某个 codoc reference 进 chat
3. 在 chat 中 review 该 codoc 的渲染结果
4. 调用 summary agent，在 chat 中看到生成的摘要预览
5. 确认写入，摘要写入目标 codoc 的对应字段
6. 写入触发下游 codoc 标脏，在 chat 中 review 下游 codoc 时看到 stale 标记

---

## 附：两层之间的边界

Cobook 通过 Workspace API 与 core 交互。所有对知识图谱的操作都通过四个 API 入口（listDocs、getDependencyGraph、loadDoc、onFieldChange），不绕过 Workspace 直接操作 codoc 内核。

核心等式仍然只有一个：`observe(codata) → force(deps) → value → propagate(dependents)`。M5-core 把这个等式从单棵 tree 扩展到多棵 tree 构成的 DAG。Cobook 的 chat + agent 是这个等式在产品侧的交互形态——reference 是选择 observe 的目标，review 是触发 observe，generate 是 agent 执行 force，confirm 是人类审阅后允许 propagate。