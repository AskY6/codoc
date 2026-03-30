# CoDoc / Cobook 项目目录结构

---

## Monorepo 总览

```
codoc/
├── packages/
│   ├── core/                    @codoc/core
│   ├── graph/                   @codoc/graph
│   ├── source/                  @codoc/source
│   ├── render/                  @codoc/render
│   └── workspace/               @cobook/workspace
├── apps/
│   └── cobook/                  cobook 应用
└── package.json                 monorepo root
```

---

## @codoc/core

codoc 的抽象内核。定义模型、数据结构、loader interface、校验。零外部实现依赖。

```
packages/core/
├── src/
│   ├── model/                       static codoc 模型
│   │   ├── codoc.ts                     .codoc 文件的完整类型定义（type + data + view 三元组）
│   │   ├── schema.ts                    type 层：JSON Schema 的 codoc 扩展约定（description 语义、$source/$ref 标记）
│   │   ├── data.ts                      data 层：data tree 节点类型（literal, $ref, $source, $prompt 的声明结构）
│   │   └── view.ts                      view 层：MDX 模板的类型约定
│   │
│   ├── codata/                      codata 数据结构
│   │   ├── node.ts                      codata 节点（meta + value 双层结构）
│   │   ├── tree.ts                      codata tree（data tree 的运行时表示，节点间有父子关系）
│   │   ├── state.ts                     节点状态机（idle → forcing → resolved → dirty → forcing ...）
│   │   └── observe.ts                   observe 协议（外部触发 observe → 检查状态 → 决定是否 force）
│   │
│   ├── loader/                      loader 体系
│   │   ├── interface.ts                 SourceLoader / SourceWatcher interface 定义
│   │   ├── registry.ts                  loader registry（注入口，source type → loader 实现的映射）
│   │   ├── literal.ts                   literal loader（直接返回值，内置）
│   │   └── ref.ts                       $ref loader（data tree 内部路径解析，内置）
│   │
│   ├── validation/                  校验
│   │   └── schema-validator.ts          JSON Schema validation（封装 Ajv，force 后校验值是否符合 type）
│   │
│   ├── runtime/                     codoc runtime（单文档级别的执行引擎）
│   │   ├── runtime.ts                   核心执行循环：接收 observe → 调度 force → 返回值
│   │   ├── force.ts                     force 执行器：根据节点类型分派到对应 loader
│   │   └── subscribe.ts                 subscribe/observe 分离：subscribe(node, callback) → unsubscribe
│   │
│   └── index.ts                     公共导出
│
├── package.json
└── tsconfig.json
```

core 不含 graph 实现、不含 source 实现、不含 render。通过 interface + registry 注入机制与外部包集成。

---

## @codoc/graph

通用的响应式 DAG 调度库。自定义 interface，不依赖任何 codoc 包。

```
packages/graph/
├── src/
│   ├── types.ts                    自有 interface 定义（ReactiveGraph, Node, Edge, DirtySet 等）
│   ├── dag.ts                      DAG 数据结构（节点集 + 边集，增量添加/移除）
│   ├── cycle-detection.ts          循环检测（添加边时实时检测，非全量扫描）
│   ├── topo-sort.ts                拓扑排序（给定脏节点集，返回求值顺序）
│   ├── parallel-layers.ts          并行分层（拓扑排序后按层分组，同层可并发）
│   ├── dirty-propagation.ts        标脏传播（给定变更源，沿 DAG 向下游标记所有受影响节点）
│   ├── reactive-graph.ts           组合入口：实现自有 ReactiveGraph interface
│   └── index.ts
│
├── package.json
└── tsconfig.json
```

graph 是零依赖的独立库。core 通过 adapter 适配 graph 的 interface，而非反向。

---

## @codoc/source

数据源的完整实现。统一了 URL fetch 和平台 connector 两条路径，对 core 暴露为同一个 `$source` loader。

```
packages/source/
├── src/
│   ├── providers/                   按 source 类型组织，每种提供 loader + watcher
│   │   ├── http/
│   │   │   ├── loader.ts                HTTP GET 取值
│   │   │   └── watcher.ts               polling / ETag / Last-Modified 变更检测
│   │   │
│   │   ├── local-file/
│   │   │   ├── loader.ts                读取本地文件内容，parse 为值
│   │   │   └── watcher.ts               fs.watch 监听文件内容变更
│   │   │
│   │   ├── local-directory/
│   │   │   ├── loader.ts                扫描目录，返回文件列表
│   │   │   └── watcher.ts               fs.watch 监听文件增删
│   │   │
│   │   ├── websocket/
│   │   │   ├── loader.ts                WebSocket 连接取值
│   │   │   └── watcher.ts               持续连接，服务端推送变更
│   │   │
│   │   ├── rss/
│   │   │   ├── loader.ts                RSS/Atom feed 解析
│   │   │   └── watcher.ts               定时轮询
│   │   │
│   │   ├── llm/
│   │   │   ├── loader.ts                LLM API 调用 + schema-constrained output
│   │   │   └── watcher.ts               无主动 watch（$prompt 由上游依赖变更触发重算）
│   │   │
│   │   └── feishu/                  飞书平台 provider
│   │       ├── table.ts                 飞书多维表格（Bitable）记录拉取
│   │       ├── doc.ts                   飞书文档内容拉取（markdown / text / blocks）
│   │       ├── bot.ts                   飞书机器人消息
│   │       └── auth.ts                  飞书 tenant_access_token 获取与缓存
│   │
│   ├── parsers/                     数据格式解析器（跨 provider 复用）
│   │   ├── jsonl.ts                     JSONL 解析
│   │   ├── json.ts                      JSON 解析
│   │   ├── csv.ts                       CSV 解析
│   │   └── xml.ts                       XML / RSS feed 解析
│   │
│   ├── cache/                       缓存策略
│   │   ├── strategy.ts                  缓存策略 interface（stale-while-revalidate, TTL, ETag 等）
│   │   └── store.ts                     缓存存储（内存 / 持久化）
│   │
│   ├── auth/                        认证管理（统一所有 provider 的 credential 存取）
│   │   ├── credential-store.ts          credential 存储（内存 singleton）
│   │   └── env-loader.ts               从环境变量加载 credential
│   │
│   ├── register-all.ts              便捷函数：一次注册所有内置 provider 到 loader registry
│   └── index.ts
│
├── package.json                     依赖 @codoc/core
└── tsconfig.json
```

### connector → provider 的统一

原有的 `connector` 概念（`ConnectorFn`, `ConnectorMeta`, `ConnectorDefinition`）合并为 source 包内的 **provider** 模式。不再区分"URL fetch"和"connector dispatch"两条路径：

- `$source: "https://..."` → 路由到 `providers/http/loader.ts`
- `$source: { provider: "feishu-table", ... }` → 路由到 `providers/feishu/table.ts`

所有 provider 共享同一套 cache strategy 和 auth 管理。

---

## @codoc/render

渲染引擎。将 codata 渲染为可呈现的输出。独立成包，隔离前端依赖（@mdx-js/mdx、React 等）。

```
packages/render/
├── src/
│   ├── compiler.ts                  MDX 编译（封装 @mdx-js/mdx，.codoc view → 可执行模块）
│   ├── adapter.ts                   codata → 渲染框架的适配层（React Suspense 适配）
│   ├── component-registry.ts        组件注册表（view 中可用的 JSX 组件映射）
│   └── index.ts
│
├── package.json                     依赖 @codoc/core, @mdx-js/mdx, react
└── tsconfig.json
```

core 不知道 render 的存在。render 读 core 的 codata tree 和 view 类型，自行完成编译和渲染。

---

## @cobook/workspace

Headless 的 workspace 管理器。组装 codoc 各包，管理 codoc 文档生命周期。

```
packages/workspace/
├── src/
│   ├── lifecycle/                   Codoc 实例生命周期
│   │   ├── manager.ts                   创建 / 销毁 codoc 实例
│   │   ├── instance-store.ts            workspace 内所有 codoc 实例的存储
│   │   └── codoc-factory.ts             构造完整的 codoc 实例（解析 .codoc → 注入 graph → 绑定 source）
│   │
│   ├── watch/                       Watch 编排
│   │   ├── orchestrator.ts              接收 source watcher 的变更信号，路由到正确处理路径
│   │   │                                  - 已有 codoc 的 source 变更 → graph.markDirty
│   │   │                                  - 数据源目录新增资源 → lifecycle.create
│   │   └── source-binding.ts            将 codoc 实例的 $source 声明绑定到 source watcher
│   │
│   ├── wiring/                      组装层
│   │   └── bootstrap.ts                 workspace 启动：注册 source providers → 适配 graph → 初始化 watch
│   │
│   ├── api/                         Workspace API
│   │   ├── workspace-api.ts             对外暴露的统一接口实现
│   │   │                                  - listDocs(): DocMeta[]
│   │   │                                  - getDependencyGraph(): GraphSnapshot
│   │   │                                  - loadDoc(id): ResolvedDoc
│   │   │                                  - onFieldChange(id, field, callback): unsubscribe
│   │   └── types.ts                     API 的类型定义（DocMeta, GraphSnapshot, ResolvedDoc 等）
│   │
│   └── index.ts
│
├── package.json                     依赖 @codoc/core, @codoc/graph, @codoc/source
└── tsconfig.json
```

workspace 是 graph adapter 的所在地：在 `wiring/bootstrap.ts` 中将 `@codoc/graph` 的 ReactiveGraph 适配为 core runtime 需要的 interface，完成注入。

---

## cobook

最终的应用层。面向用户的知识管理产品。

```
apps/cobook/
├── src/
│   ├── chat/                        Chat 引擎
│   │   ├── engine.ts                    树状对话核心数据结构（节点、分支、context 继承）
│   │   ├── reference.ts                 codoc reference 管理（在对话中 reference 一个 codoc）
│   │   ├── review.ts                    review 流程（reference → observe → render 在 chat 中）
│   │   └── history.ts                   对话持久化
│   │
│   ├── agent/                       Agent 编排
│   │   ├── executor.ts                  LLM 调用编排（读 codoc → 构造 prompt → 调 LLM → 返回结果）
│   │   ├── confirm-flow.ts              generate → preview → confirm → write 流程
│   │   └── presets/                     预置 agent
│   │       ├── summary.ts                   生成摘要
│   │       ├── validate.ts                  校验一致性
│   │       └── polish.ts                    润色内容
│   │
│   ├── ui/                          前端 UI
│   │   ├── layout/                      三面板布局
│   │   │   ├── doc-list.tsx                 左侧：codoc 列表
│   │   │   ├── chat-panel.tsx               中间：树状 chat
│   │   │   └── agent-panel.tsx              右侧：agent 面板
│   │   ├── components/                  通用 UI 组件
│   │   └── app.tsx                      应用入口
│   │
│   └── index.ts
│
├── package.json                     依赖 @cobook/workspace, @codoc/render
└── tsconfig.json
```

---

## 依赖方向汇总

```
cobook
  ├── @codoc/render       → @codoc/core
  └── @cobook/workspace
        ├── @codoc/core
        ├── @codoc/graph                    （零依赖，自有 interface）
        └── @codoc/source  → @codoc/core
```

所有箭头单向向下。无环。无跨层穿透。

graph 不依赖 core。workspace 负责适配 graph interface → core runtime。

---


## claude code log viewer
todo