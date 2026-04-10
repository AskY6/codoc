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

一个 `cobook` project 就是一个 workspace。

workspace 负责定义：

- 项目根目录
- `cobook.yaml`
- `.codoc` 文件集合
- 局部组件、schema、示例数据和未来的插件配置

workspace 是用户协作和 runtime 运行的边界。

### 2.2 Codoc

`codoc` 是 Cobook 的最小知识单元。它不是普通文档文件，而是一个可计算、可校验、可被引用的结构化对象。

稳定形态上，一个 codoc 可以包含以下部分：

- `meta`: 约束和描述
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

所有 codoc 的依赖关系最终会归一到一张字段级 DAG。

这张图是系统的计算核心。它决定：

- 依赖是否合法
- 是否存在循环
- 哪些节点需要先算
- 哪些节点在上游变化后失效

文件级依赖图只是字段级图的投影，不是独立真相。

## 3. 设计原则

### 3.1 一切沉淀为 codoc

AI 对话、外部抓取、用户整理后的结果，最终都应当尽可能落成 codoc，而不是只停留在对话历史里。

### 3.2 显式依赖优先于隐式魔法

依赖关系应该通过 `$ref`、`$source`、schema 和服务接口表达，而不是藏在 prompt、组件副作用或 CLI 临时逻辑里。

### 3.3 字段级图是真相

系统内部的真实依赖粒度应该足够细，至少细到 `data` 字段级别。  
更粗的文件级视图可以派生，但不能反过来主导运行时。

### 3.4 CLI-first，但必须 server-shaped

第一阶段只做 CLI，没有问题。  
但 CLI 只是交互面，不应该拥有工作区状态、文件写入、DAG 调度或 LLM 调用。

这意味着：

- 可以先没有真正的 HTTP / WebSocket server
- 但必须先有统一的服务边界
- CLI 和未来 Web 都应该通过同一类服务接口访问 runtime

### 3.5 Core 保持纯，副作用集中

`core` 负责：

- 解析
- 规范化
- 校验
- 建图
- 运行时状态机

文件系统、网络、watch、LLM、source 执行都属于副作用，应集中在 service/runtime 层，而不是散落在 UI 或 parser 里。

### 3.6 AI 也是系统内参与者，不是旁路

AI 不应绕过系统直接改文件或凭空组织上下文。  
它应该通过统一服务接口读取 codoc、查询图、生成新 codoc，并触发重建与校验。

## 4. 系统分层

当前设计建议拆成 4 层：

```text
UI Layer
  CLI now, Web later

Service Layer
  workspace session
  runtime orchestration
  source execution
  AI integration

Core Layer
  parser
  ref normalization
  schema validation
  DAG
  resolve / invalidate semantics

Workspace Assets
  cobook.yaml
  *.codoc
  local files
```

### 4.1 UI Layer

第一阶段只有 CLI，后续会有 Web。  
无论是哪种 UI，都不应直接操作 workspace 内部状态。

UI 的职责应该只包括：

- 接收用户输入
- 展示流式输出
- 命令路由和结果格式化

### 4.2 Service Layer

Service Layer 是系统的执行边界。

它负责：

- 打开 workspace
- 维护 workspace session
- 调用 parser / dag / runtime
- 管理 source 执行
- 暴露统一服务接口给 CLI、Agent、未来 Web

它是“CLI-first 但 server-shaped”的关键。

### 4.3 Core Layer

Core Layer 只关心语义和计算，不关心终端、浏览器、网络传输和文件监听细节。

它输出的核心能力应该是：

- 从 `.codoc` 得到标准 AST
- 从 `$ref` 得到稳定 NodeId
- 从 codoc 集合得到 DAG
- 从 DAG 和 source 执行器得到 resolved value
- 在结构变化和值变化之间做清晰区分

### 4.4 Workspace Assets

workspace 是运行时的输入，同时也是 AI 沉淀知识的输出位置。

这层的设计目标不是抽象掉文件系统，而是：

- 让 workspace 成为清晰边界
- 让所有修改都通过统一服务层发生
- 保证变更后能触发重建、校验和失效传播

## 5. 运行时模型

### 5.1 数据声明

`data` 不是单纯的静态值容器，而是依赖声明与求值入口。

从 MVP 开始，至少支持：

- `static`
- `file`
- `codoc`

未来可扩展：

- `http`
- `rss`
- `derived`
- 其他插件 source

### 5.2 Build 与 Resolve

运行时至少要区分两类动作：

- `build`: 从 codoc 集合建图、校验、生成依赖关系
- `resolve`: 在已有图上按需求值某个节点

它们不是一回事：

- `build` 解决结构正确性
- `resolve` 解决值计算

### 5.3 结构变化与值变化

系统必须从一开始就区分这两类变化：

- 结构变化：某个 codoc 文件内容改变，导致节点或边改变
- 值变化：某个 source 的结果变了，但依赖结构没变

这两种变化的处理路径不能混为一谈。

### 5.4 错误边界

错误需要被视为节点状态的一部分，而不是异常地散落出去。

至少要支持这些状态语义：

- `idle`
- `computing`
- `ready`
- `dirty`
- `error`

这样后续无论是 CLI 展示、Web 展示还是 Agent 恢复，都有统一基础。

## 6. AI 与交互模型

### 6.1 先做一个基础 Agent

第一阶段不做完整多 agent 路由，而是只做一个 `base-agent`。

这个 agent 的职责很明确：

- 读取 workspace 概览
- 读取指定 codoc
- 查询依赖图或 resolve 结果
- 创建新 codoc
- 更新已有 codoc

它不应该直接碰 `fs`，也不应该绕过服务边界。

### 6.2 Chat 是能力入口，不是系统本体

Chat 很重要，但不应主导设计。  
真正的本体仍然是 codoc 图谱和 runtime。

换句话说：

- Chat 是操作系统的终端
- codoc 图谱才是操作系统管理的对象

### 6.3 上下文应该可控

AI 的输入边界需要显式控制，而不是“把整个项目一股脑塞进去”。

后续无论用 pinned codocs、project summary，还是其他机制，目标都一样：

- 控制 token 预算
- 让 AI 感知范围可解释
- 让用户知道 AI 是基于什么在行动

## 7. 扩展模型

### 7.1 Source 扩展

`$source` 是重要扩展点，但扩展应该建立在稳定 runtime 上。  
先有统一 source 执行语义，再谈插件生态。

### 7.2 View 与 Component 扩展

`view` 和 `component` 很有价值，但不应该先于数据图谱和服务边界成形。

设计顺序应当是：

1. 先证明 data graph 成立
2. 再证明最小 view 渲染成立
3. 最后才扩展完整 MDX 和组件系统

### 7.3 多 Agent 扩展

场景 agent 是第二层能力，不是第一层基础设施。

在基础 Agent、服务边界和 codoc 写入闭环稳定之前，不应该过早引入复杂路由、意图编排和多角色协作。

## 8. 边界与非目标

以下内容不是当前稳定设计的核心承诺，至少不应出现在第一阶段：

- 完整 Web 界面
- WebSocket 实时同步
- 场景 agent 路由系统
- RSS 垂直场景
- 远程组件加载
- 完整 MDX runtime
- source 插件市场

这些都可能是后续阶段的重要内容，但不应绑在第一阶段一起落地。

## 9. 当前最重要的架构约束

这几条如果破了，后面很容易返工：

- CLI 不能直接依赖 `core` 做业务执行
- Agent 不能直接改 workspace 文件
- 所有写操作都必须经过统一 service 边界
- `core` 不承载文件系统和网络副作用
- 字段级 DAG 依然是唯一依赖真相

## 10. 当前的开放问题

这些问题可以延后，但不能永远模糊：

- `derived` 计算最终是允许受限 JS，还是要收敛成 DSL
- `view` 在 MVP 用什么最小表达形式承接展示
- source 的 cache / retry / watch 在哪一层建模最合理
- 未来 server 进程和本地嵌入式 service 如何共用同一接口
- AI 产出的 codoc 模板和风格如何保持稳定

## 11. 文档分工

为了避免未来再次把设计、实现、阶段计划混在一起，建议保持下面的文档职责：

- [design.md](/Users/kxzhang/code/local-tool/codoc/design.md)
  - 描述稳定设计主线
  - 关注对象模型、边界、原则和约束