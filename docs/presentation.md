# Codoc: 让文档成为可计算的知识单元

以 codoc local 版本为主要分享目标，以 codoc-demo（技术选型工作区）为演示案例


## 一句话定位

Codoc 是一种结构化知识文档格式与运行时。它将传统文档升级为带数据字段、跨文档引用、依赖图的可计算单元，并通过 MCP 协议让 AI Agent 原生读写这些文档。


## 问题：文档为什么还停留在"纯文本"时代？

传统文档的困境：
- 信息孤岛 — 文档之间无法引用具体字段，只能复制粘贴
- 变更不可追踪 — 修改一处数据，不知道哪些下游文档受影响
- AI 只能"读" — LLM 辅助写作，但无法理解和操作文档结构
- 渲染是死的 — Markdown 输出静态内容，无法数据驱动

Codoc 的回答：
- 字段级 $ref 跨文档引用
- DAG 追踪依赖链，自动传播变更
- MCP 工具暴露完整 CRUD，AI 是一等公民
- MDX 格式，数据驱动渲染


## 演示场景：React 状态管理技术选型

codoc-demo 是一个用 codoc 格式管理的竞品分析工作区，评估 Redux Toolkit / Zustand / Remesh 三个方案。

### 工作区结构

```
codoc-demo/
  .codoc/                        ← 源文件（Agent 通过 MCP 操作）
    candidates/
      redux.codoc                ← 方案档案：名称、star 数、bundle size、特性
      zustand.codoc
      remesh.codoc
    evaluations/
      redux.codoc                ← 评估文档：引用 candidate + weights，动态计算加权总分
      zustand.codoc
      remesh.codoc
    weights.codoc                ← 权重配置：修改后联动所有 evaluation 和 decision
    decision.codoc               ← 决策总览：引用所有 evaluations，生成对比矩阵
  out/                           ← 编译产物（MDX + JSX 组件）
  codoc.config.json
```

### 数据流向（DAG）

```
weights.codoc ─────────────────────────────────────┐
                                                   ▼
candidates/redux.codoc ───→ evaluations/redux.codoc ───┐
candidates/zustand.codoc ─→ evaluations/zustand.codoc ─┼──→ decision.codoc
candidates/remesh.codoc ──→ evaluations/remesh.codoc ──┘
```

改一个 candidate 的 star 数 → evaluation 自动更新 → decision 对比矩阵跟着变。
改一个 weights 的权重值 → 所有 evaluation 的加权总分重算 → decision 排名重排。


## 核心能力


### 能力一：结构化文档格式 .codoc

一个 codoc 文件由三个 block 组成：meta / data / view

以 `candidates/zustand.codoc` 为例：

```yaml
# meta — 描述性元信息
title: "Zustand"
tags: [state-management, react, minimal]

# data — 可计算的数据字段
data:
  name: "Zustand"
  stars: 57800
  bundle_size_kb: 1
  features:
    - "极简 API（一个 create 函数搞定）"
    - "超轻量（核心 ~1kb gzipped）"
    - "无 Provider 包裹，开箱即用"
```

```
# view — MDX 渲染模板

import { StatRow } from '../components/StatRow.jsx'

# {data.name}

<StatRow items={[
  { label: "Stars", value: data.stars.toLocaleString() },
  { label: "Bundle", value: data.bundle_size_kb + "kb" },
]} />
```

三层各有职责：
- meta — 标题、标签、字段 schema 声明
- data — 三种变体：static（字面值）、$ref（引用别人的字段）、$formula（表达式计算）
- view — MDX 模板，通过 {data.xxx} 插值消费数据，可使用 JSX 组件


### 能力二：字段级跨文档引用（$ref）

以 `evaluations/redux.codoc` 为例 — 它同时引用 candidate 和 weights：

```yaml
data:
  name:
    $ref: "../candidates/redux.codoc#data.name"
  stars:
    $ref: "../candidates/redux.codoc#data.stars"
  w_api_design:
    $ref: "../weights.codoc#data.w_api_design"
  w_performance:
    $ref: "../weights.codoc#data.w_performance"
  score_api_design: 3        # ← static，评估者打分
  score_performance: 4
```

`decision.codoc` 更进一步，引用所有 evaluation 的分数并在 view 中计算加权总分：

```jsx
<CompareTable
  columns={["Library", "Score", "Bundle", "Summary"]}
  rows={[
    [data.redux_name,
     (data.redux_s1*data.w_api_design + data.redux_s2*data.w_performance + ...).toFixed(2),
     data.redux_bundle + "kb",
     data.redux_summary],
    ...
  ]}
/>
```

所有数据追溯到源头：candidate 的 star 数改了 → evaluation 引用更新 → decision 矩阵重算。没有复制粘贴，没有手动同步。


### 能力三：依赖图（DAG）

当多个 codoc 通过 $ref 互相引用时，运行时自动构建依赖图。

节点寻址：`evaluations/redux.codoc#data.stars` → 追溯到 `candidates/redux.codoc#data.stars`

DAG 提供四个核心能力：
- 循环检测 — 编辑时即刻告警，不允许循环引用
- 拓扑排序 — 确定正确的计算顺序
- 失效传播 — 一个字段变更，BFS 扩散出所有下游节点
- 纯函数求值 — 给定源头值，递推出全图结果

核心 API — 全是纯函数，无副作用：

```typescript
buildDAG(astMap)        // 两趟：物化节点 → 添加边
checkCycles(dag)        // DFS 三色标记，返回所有环
topoSort(dag)           // Kahn 算法
invalidate(dag, seed)   // BFS 失效传播
evaluate(dag, sources)  // 给定源头值，纯递推
```


### 能力四：MCP 工具集 — AI 原生读写

codoc local 以 MCP Server 身份运行，Claude Code 直接获得五个工具：

- list_codocs — 列出工作区所有文档及元信息
- read_codoc — 读取源码 + 已解析的数据
- write_codoc — 写入完整文档源码（自动校验 + 编译）
- search_codocs — 按内容 / 标题 / 标签搜索
- dag_status — 检查引用完整性和循环

效果：AI Agent 不是在"辅助人写文档"，而是直接操作结构化知识。它能创建一组互相引用的 codoc，DAG 自动验证引用完整性。

demo 中还定义了 Claude Code slash command：

```
/evaluate zustand
→ Claude 读取 candidate → 逐维度打分 → 写入 evaluations/zustand.codoc
→ $ref 引用 candidate 和 weights，DAG 自动接管依赖关系
```


### 能力五：实时编译 + 预览

数据流：

```
.codoc/candidates/redux.codoc
.codoc/candidates/zustand.codoc       →  parse → resolve → compile
.codoc/evaluations/redux.codoc
.codoc/weights.codoc
                                            ↓

out/candidates/redux.mdx
out/evaluations/redux.mdx
out/decision.mdx
out/components/ScoreChart.jsx    ← JSX 组件：柱状图、对比表格、Badge、Callout
```

编译结果示例 — `out/decision.mdx` 中所有 $ref 已内联为实际值：

```js
export const data = {
  "redux_name": "Redux Toolkit",
  "redux_bundle": 14,
  "zustand_name": "Zustand",
  "zustand_bundle": 1,
  "w_api_design": 0.2,
  ...
}
```

- Watch 模式下文件保存后自动重编译
- $ref 被解析为实际值，内联到 MDX
- VSCode MDX 插件直接预览最终渲染效果（含 ScoreChart 柱状图、CompareTable 对比矩阵）
- 编译输出是自包含的 MDX — 不再依赖运行时


## 核心架构


### 整体分层

```
┌─────────────────────────────────────────────┐
│  apps/local        CLI + MCP Server         │  ← 今天演示的
├─────────────────────────────────────────────┤
│  @cobook/service   业务编排（解析器等）       │
│  @cobook/compiler  AST → MDX 纯编译         │
├─────────────────────────────────────────────┤
│  @cobook/core      纯领域类型 + 纯函数       │  ← 零依赖
│    ├── codoc/      文档 ADT                 │
│    ├── dag/        依赖图算法                │
│    └── shared/     Result, Brand            │
└─────────────────────────────────────────────┘
```

关键设计约束：
- 依赖方向严格向内，core 零运行时依赖
- 所有 ID 使用 branded type — CodocId、NodeId、CodocPath 编译期防混用
- 纯函数返回 Result<T, E>，不抛异常
- 非法状态用 ADT 在类型层面消除


### apps/local 三种运行模式

```
codoc watch [dir]     监视 + 实时编译（默认）
codoc mcp [dir]       MCP Server + 后台监视
codoc compile [dir]   一次性编译后退出
codoc dag [dir]       打印 DAG 关系后退出
```

设计哲学：文件即持久化。

没有数据库、没有 storage 层、没有 session 管理。.codoc 文件本身就是 source of truth，编译输出是 .mdx 派生产物。AI Agent 拥有对话状态，codoc local 只管文档。


### 数据流管线

用户编辑或 AI 写入 .codoc 文件
→ Chokidar 监听变更
→ parseCodoc() 解析为 CodocAST
→ buildDAG() 校验引用、检测循环
→ resolveDataFields() 解析 $ref 为实际值
→ compileCodoc() 输出独立 MDX 文件
→ VSCode 预览

MCP 模式下 AI 调用 write_codoc 时走相同管线，但多一步：写入前先 parseCodoc 校验语法，通过才落盘。


## 现场演示流程


### Demo 1：编译 + 预览

```bash
pnpm compile
# → compiled 9 file(s) → out/
```

打开 `out/decision.mdx` — 所有 $ref 已内联为实际值，对比矩阵一目了然。


### Demo 2：改权重看联动

```bash
pnpm watch
```

编辑 `.codoc/weights.codoc`，把 `w_performance: 0.20` 改成 `w_performance: 0.40`。

观察：所有 `out/evaluations/*.mdx` 的加权总分自动重算，`out/decision.mdx` 排名跟着变化。


### Demo 3：改数据看联动

编辑 `.codoc/candidates/zustand.codoc`，把 `stars: 57800` 改成 `stars: 58000`。

观察：`out/evaluations/zustand.mdx` 和 `out/decision.mdx` 自动更新，star 数同步变化。


### Demo 4：Agent 操作

```bash
claude --mcp-config .claude/mcp.json
```

对话示例：

```
User: 帮我新增一个候选方案 Jotai，填入基本信息
Claude: (调用 write_codoc 创建 candidates/jotai.codoc)

User: /evaluate jotai
Claude: (读取 candidate → 逐维度打分 → 写入 evaluations/jotai.codoc，$ref 引用 candidate + weights)

User: 更新决策文档，把 Jotai 加进对比矩阵
Claude: (read_codoc decision.codoc → 增加 jotai refs → write_codoc)

User: dag_status 看看引用图是否健康
Claude: (调用 dag_status → 报告节点数、边数、无异常)
```


### Demo 5：故意断链演示 DAG 验证

```bash
rm .codoc/candidates/remesh.codoc
pnpm compile
# → [codoc/dag] unknown-target: evaluations/remesh.codoc#data.name → ...
# → 编译仍然成功，但 DAG 警告指出断链位置
```


## 与同类方案的区别

Notion / Confluence：
- 引用粒度：页面级链接
- 数据依赖：无
- AI 集成：辅助写作
- 本地优先：否

Obsidian + Dataview：
- 引用粒度：文件级 wikilink
- 数据依赖：查询（只读）
- AI 集成：插件
- 本地优先：是

Codoc：
- 引用粒度：字段级 $ref
- 数据依赖：DAG + 双向传播
- AI 集成：MCP 原生 CRUD
- 本地优先：是


## 技术亮点总结

1. 代数数据类型 (ADT) — DataField 三变体（static / $ref / $formula），非法状态不可构造
2. Branded Types — 编译期 ID 防混用，零运行时开销
3. 纯函数核心 — DAG 算法全部无副作用，可测试可复用
4. MCP 协议 — 标准化 AI 工具接口，不绑定特定 LLM
5. 编译 pipeline — source → AST → resolve → MDX，每步可独立替换
6. JSX 组件系统 — ScoreChart / CompareTable / Badge / Callout，数据驱动的可视化渲染


## Q&A 预设

Q: codoc 和 Jupyter Notebook 有什么区别？
A: Jupyter 是执行环境（code cell → output）。Codoc 是声明式知识单元（data field → resolved value → rendered view）。Codoc 不执行代码，它解析引用关系。

Q: 为什么不直接用 Markdown + YAML frontmatter？
A: Codoc 的 data block 不只是元数据——它是可计算的。$ref 让字段跨文档求值，$formula 让表达式参与计算。普通 frontmatter 做不到。

Q: Local 版本和 Server 版本的关系？
A: 同一套 core + compiler + service。Local 版本文件即存储；Server 版本加了持久化（PostgreSQL）、多人协作、Chat Thread、Agent 路由。架构上是同一棵树的不同果实。

Q: 这个技术选型 demo 的数据是写死的吗？
A: candidate 的基础数据（stars、bundle size）是 static 字段，可以手动维护也可以让 AI 从 npm/GitHub 抓取后写入。evaluation 的分数由 AI Agent 通过 /evaluate 命令自动打分生成。所有数据通过 $ref 链式引用，修改源头后下游自动联动——这正是 codoc 相比纯文本的核心价值。
