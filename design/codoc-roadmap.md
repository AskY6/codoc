# CoDoc Roadmap

终态：多文档协作网络（workspace 级）

---

## M0 — Codata 内核

**交付：** 一个可运行的 codata 数据结构 + 最小 loader

- codata 双层结构实现（meta 立即可读，value 按需 force）
- 字面量 loader（直接返回值）
- `$ref` loader（从 data tree 内部解析引用）
- JSON Schema validation（force 后校验值是否符合 type）

**验证标准：** 构造一棵含 `$ref` 的 data tree，观察任意字段能正确 force 出值

---

## M1 — Relation Engine

**交付：** 依赖图的构建与标脏传播

- 从 codata meta 层静态提取依赖关系
- 构建 DAG + 循环检测
- 拓扑排序（确定 force 顺序 + 并行分层）
- 标脏传播（值变更 → 通知下游失效）

**依赖：** M0（需要 codata 的 meta 结构）

**验证标准：** 修改一个字段的值，依赖它的下游字段自动标脏并重新 force

---

## M2 — Render Engine + 单文档渲染

**交付：** 观察驱动的文档渲染闭环

- MDX 编译（view → component）
- codata 观察协议适配到 React Suspense
- 观察触发 force，force 完成触发渲染
- 变更 → 标脏 → 重新观察 → 重新渲染的完整循环

**依赖：** M0 + M1

**验证标准：** 一个 `.codoc` 文件（type + data + view）能渲染为可交互的页面，修改 data 字段后页面自动更新

> **M2 = MVP。** 核心等式 `observe → force → value → propagate` 完整跑通。

---

## M3 — 扩展 Loader 类型

**交付：** 支持异步外部数据源和 LLM 求值

- `$source` loader（远程数据获取 + 缓存策略）
- `<Prompt />` loader（LLM 调用 + schema-constrained output）
- 统一的 loader 错误处理（失败、超时、降级）
- 异步 force 的并行调度（同拓扑层级内并发）

**依赖：** M2（需要完整的 observe → force → render 循环）

**验证标准：** 一个 `.codoc` 中混合使用字面量、`$ref`、`$source`、`<Prompt />`，全部正确 force 并渲染

---

## M4 — 跨文档引用

**交付：** 文档间的 codata 互相观察

- `[[external.codoc]].data.field` 引用解析
- 跨文档 loader（observe 外部 `.codoc` 的 codata 字段）
- 跨文档标脏传播（A 的字段变了 → 依赖它的 B 自动失效重算）
- 文档级依赖图（哪些 `.codoc` 依赖了哪些 `.codoc`）

**依赖：** M3（跨文档引用的目标字段可能是任意 loader 类型）

**验证标准：** A.codoc 引用 B.codoc 的字段，B 的字段更新后 A 自动重新渲染

---

## M5 — Workspace

**交付：** 多文档协作网络

- Workspace 级全局依赖图（所有 `.codoc` 的字段级引用关系）
- 冷启动策略（增量恢复 vs 全量重建）
- External dependency 边界（workspace 外的引用如何处理）
- Workspace 级并发控制（多个文档同时被 Agent 写入时的一致性）

**依赖：** M4（需要跨文档引用作为基础）

**验证标准：** 一个 workspace 内多个 `.codoc` 形成依赖网络，任意节点变更正确传播到所有受影响的文档

---

## 里程碑依赖关系

```
M0 (codata 内核)
 └→ M1 (relation engine)
     └→ M2 (render + 单文档) ← MVP
         └→ M3 (扩展 loader)
             └→ M4 (跨文档引用)
                 └→ M5 (workspace)
```

整条路径是严格线性依赖的。每个里程碑在上一个的基础上扩展，不改变已有模型——始终是同一个等式：`observe(codata) → force(deps) → value → propagate(dependents)`。
