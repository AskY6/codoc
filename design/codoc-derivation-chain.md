# CoDoc 推导链路

从最初的设计意图到 codata 模型的完整思考路径。

---

## 起点：依赖图的边界问题

**问题：** CoDoc 文档间通过 `$ref` 和 `[[external]]` 形成依赖图。类似 Webpack 有 entry 作为依赖解析的起点，CoDoc 的依赖图边界是什么？

**推导：** Webpack 的 entry 定义了"从哪里开始追踪依赖"，是单向的——entry 依赖谁就 bundle 谁。但 CoDoc 需要双向：向下 resolve 依赖（渲染时），向上通知变更（传播时）。这意味着 CoDoc 需要两种 entry 语义——render entry（当前文档）和 propagation entry（变更源头）。

**结论：** CoDoc 的边界不是单个 entry，而是 workspace。Workspace 内所有 `.codoc` 构成完整的依赖图，类似 monorepo 的 project boundary。

---

## 第一步：Compute Engine 的职责

**问题：** 如果每个 `.codoc` 对外输出 data + view component，compute engine 应该如何设计？

**推导：** Compute engine 的职责是把 data 从"声明态"变成"求值态"——解析 `$ref`、获取 `$source`、执行 `<Prompt />`。View 的 MDX 编译是独立的静态过程，不依赖 data 求值。

**追问：** compute 要解决的核心问题是什么？

**结论：** 把 data 中所有"尚未确定的值"变成"确定的值"。跟 Excel 把公式算成值是同一个本质。View 是 resolved data 的纯消费者，不参与求值。

---

## 第二步：Agui 打破了 view 的纯粹性

**问题：** Agui 是意图驱动的智能渲染组件，它需要根据意图按需拉取数据再决定 UI。这意味着 view 层需要异步等待，不再是"拿到数据无脑渲染"。

**推导：** Agui 的数据获取应该走主 compute engine 还是自己独立处理？选择了 Agui 自己闭环——符合"每个单元自己闭环"的设计原则。

**但立刻发现问题：**

1. Agui 内部状态对下游 `.codoc` 不可见了
2. Agui 如何知道自己有哪些数据源？需要有人声明

**结论：** Agui 自己闭环的方案走不通。数据源仍然应该声明在 data 中，但标记为 lazy。Agui 在渲染时按需触发 resolve。

---

## 第三步：PromiseData 的浮现

**发现：** 数据变成了一种 PromiseData——meta 信息（类型、描述、数据源声明）对所有消费者立刻可见，但值的访问是异步的。

**意义：** 所有消费者面对统一的数据结构，区别只在消费策略。Compute engine 首次 resolve eager 字段，Agui 按需触发 lazy 字段，下游 `.codoc` 先看 meta 再取值。Relation engine 能从 meta 层就建立完整依赖图，不需要等值 resolve。

---

## 第四步：PromiseData 就是 Codata

**关键洞察：** PromiseData 的语义恰好是 codata 的定义。

- Data = 已构造好的值，可以立即解构消费
- Codata = 通过观察按需产生值，你不拥有全部内容，只能向它提问

CoDoc 的 PromiseData 正是 codata：meta 是接口声明（能问什么），value 是对观察的响应（问了才有）。

**进一步推论：** Codata 天然可以是无限的。`$source` 对接的远程数据源、`<Prompt />` 接的 LLM 生成——这些本来就不是一次性构造完的东西，它们是持续可观察的。

---

## 第五步：底层模型应该直接采用 Codata

**问题：** 应该用 PromiseData 还是 codata 作为心智模型？

**推导：** PromiseData 是实现层概念（"值还没到，等着"），会导致设计始终在想"什么时候把它们全部算完"。Codata 是语义层概念（"这个东西本来就是通过观察来定义的"），自然接受"有些字段永远不需要被 force"。

**结论：** 采用 codata 作为底层模型。连锁影响：

- Compute engine → 退化为 codata loader（被动响应观察的加载器）
- Relation engine → 追踪的是"谁观察了谁"，依赖关系由观察行为动态建立
- Render engine → 观察者，读哪个字段哪个字段才被 force

**核心公式：** data tree 是 codata，compute 是 force，render 是 observe。

---

## 第六步：Codata 是 AI 时代的天然契合

**洞察：** AI 协作的核心矛盾是 context window 有限但世界无限。Codata 解决这个矛盾——给 AI 的不是数据本身，而是数据的接口描述（JSON Schema + description）。AI 根据意图决定观察哪些字段，被观察的才去求值。

**推广：** Agent 间协作的基础不是消息传递，而是 codata 的互相观察。Type 不只是 validation schema，它是 codata 的接口定义。

---

## 第七步：新的整体架构

从 codata 心智出发，架构自然分为两层六件：

**Static doc（声明层，AI 可直接读取）：**

- Codata — schema + lazy values
- Component — atom UI 注册表
- MDX text — 编排骨架

**Runtime（执行层，对 AI 透明）：**

- Relation engine — 从 meta 静态建图
- Codata loader — 响应观察，force 值
- Render engine — 观察者，绑定 codata 到 UI

Static doc 和 runtime 之间是单向依赖：runtime 读 static doc，static doc 不知道 runtime 的存在。

---

## 第八步：与公式引擎的同构

**发现：** 如果把表格的每个 cell 视为一个 codata（有 schema、值按需 force），cell 间公式引用视为依赖图，求值由观察驱动——那这个表格公式引擎与 `.codoc` 完全同构。

**验证：** 逐一对应所有概念——`$ref` = 公式引用，`[[external]]` = IMPORTRANGE，`$source` = 外部数据连接，`<Prompt />` = AI 公式，Agui = SmartFormula，codata loader = 求值引擎，relation engine = 标脏系统……全部一一对应。

**关键区别：** 传统表格是 data 模型（同步全量求值，异步是补丁），CoDoc 是 codata 模型（异步是地基，同步只是已 resolve 的特例）。

**确认未偏离：** 这个同构是自然浮现的，不是为了拟合表格而扭曲设计。回溯每一步推导，都是从上一步的问题中逼出来的。表格类比只是验证了模型的正确性。

---

## 第九步：Codata 模型的额外收益

**并行加载：** 一次变更标脏后，依赖图的拓扑排序天然分层，同层内无互相依赖的节点可以并行 force。在异步 loader（网络请求、LLM 调用）场景下，并行和串行的差距是秒级的。这不需要额外设计，拓扑分层本身就是并行度信息。

---

## 终点：核心等式

```
observe(codata) → force(deps) → value → propagate(dependents)
```

整个系统的所有行为——渲染、变更传播、AI 读写、跨文档引用、Agui 按需拉数据——都是这一个等式的实例化。没有第二个模式。

模型简单，工程复杂。模型的简洁来自它站在两个成熟概念的交汇点上：公式引擎的响应式计算图 + codata 的惰性求值语义。工程的复杂来自这两个概念在现实中碰到的每一种边界情况。
