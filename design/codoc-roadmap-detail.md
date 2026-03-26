# CoDoc 详细 Roadmap

## 项目定位

CoDoc 是一个**文档即应用**的运行时系统：以 JSON Schema 为类型系统、以 codata 为数据模型、以 MDX 为视图层的响应式文档运行时。

它解决的核心问题是：在 AI 时代，文档不应该是静态文本，而应该是一个可计算、可观察、可被 Agent 读写的结构化应用。字段之间有依赖、有传播、有惰性求值，本质上是把 Excel 公式引擎的能力泛化到任意语义文档上。

核心等式只有一个：

```
observe(codata) → force(deps) → value → propagate(dependents)
```

---

## M0 — Codata 内核

**目标：** 实现 codata 数据结构和最小 loader 管线

### 技术栈

- 语言：TypeScript (strict mode)
- Schema：JSON Schema Draft 2020-12 (`ajv` 做 validation)
- 测试：Vitest
- 包管理：pnpm monorepo（为后续 M2 的前端包做准备）

### 模块设计

| 模块 | 职责 | 关键类型/接口 |
|---|---|---|
| `codata` | 双层结构：meta（schema + description + loader 声明）+ thunk（惰性值） | `Codata<T>`, `CodataField<T>`, `CodataMeta` |
| `loader/literal` | 字面量 loader，直接返回值 | `(meta, raw) → T` |
| `loader/ref` | `$ref` loader，从 data tree 内解析路径引用 | `(meta, path, tree) → T` |
| `schema` | JSON Schema validation，force 后校验返回值 | `validate(schema, value) → Result<T, ValidationError>` |
| `data-tree` | 管理一棵 codata 字段树，提供 `observe(path)` 和 `force(path)` | `DataTree`, `observe()`, `force()` |

### 关键设计决策

- `CodataField` 有三种状态：`idle`（未被观察）、`pending`（正在 force）、`resolved`（已有值）/ `error`
- `force` 是幂等的：多次观察同一个已 resolved 的字段直接返回缓存值
- `$ref` 路径用 JSON Pointer（RFC 6901）格式，如 `/data/user/name`

### 验收标准

1. 构造一棵包含字面量和 `$ref` 的 data tree（至少 3 层嵌套、含交叉引用）
2. `observe(path)` 返回正确值，且未被观察的字段 thunk 未执行（可通过 spy 验证）
3. `$ref` 循环引用时抛出明确错误（不 hang）
4. `force` 后值通过 JSON Schema validation，类型不匹配时返回 `ValidationError`
5. 全部单元测试通过，覆盖率 > 90%

---

## M1 — Relation Engine

**目标：** 依赖图构建、拓扑排序、标脏传播

### 技术栈

- 图算法：手写（DAG 规模小，无需第三方库）
- 可选可视化调试：`graphviz` DOT 格式输出

### 模块设计

| 模块 | 职责 |
|---|---|
| `dep-extractor` | 从 codata meta 层静态提取依赖关系（扫描 `$ref`/`$source`/`<Prompt />` 声明） |
| `dag` | DAG 数据结构：节点增删、边增删、循环检测（Kahn's algorithm） |
| `topo-sort` | 拓扑排序 + 分层（同层节点可并行 force） |
| `dirty-propagator` | 标脏传播：节点值变更 → BFS 沿下游标脏 → 返回需重算的节点集合（按拓扑序） |

### 关键设计决策

- 依赖关系从 meta 层**静态提取**，不需要实际 force 值。这意味着 relation engine 可以在任何值 resolve 之前就建好完整依赖图
- 分层信息 `layers: CodataField[][]` 天然就是并行调度信息，同层内无互相依赖
- 标脏是**推模式**（push-based）：变更源主动通知下游，而非下游轮询

### 验收标准

1. 给定一棵含 `$ref` 依赖的 data tree，自动构建出正确的 DAG
2. 循环依赖检测：`A → B → C → A` 抛出 `CyclicDependencyError`，包含环路径信息
3. 拓扑排序输出的层级正确：如 A 无依赖、B 依赖 A、C 依赖 A → `[[A], [B, C]]`
4. 标脏传播：修改 A 的值，B 和 C 被标脏，D（不依赖 A）不被标脏
5. 增量更新：新增/删除字段后 DAG 正确更新，无需全量重建

---

## M2 — Render Engine + 单文档渲染 (MVP)

**目标：** 完成 `observe → force → value → render` 闭环

### 技术栈

- MDX 编译：`@mdx-js/mdx` v3
- UI 框架：React 19（利用 Suspense 处理异步 force）
- 打包/Dev Server：Vite
- 状态绑定：`useSyncExternalStore` 或轻量自定义 hook

### 模块设计

| 模块 | 职责 |
|---|---|
| `mdx-compiler` | `.codoc` 文件的 view 部分 → React component。编译时注入 codata 绑定 |
| `codata-react` | React 适配层：`useCodata(path)` hook，内部调 `observe`，配合 Suspense 处理 pending 状态 |
| `codoc-loader` | `.codoc` 文件解析器：拆分 type / data / view 三段，分别交给对应模块 |
| `runtime` | 编排器：解析 .codoc → 构建 data tree → 建依赖图 → 编译 MDX → 挂载渲染 |

### `.codoc` 文件格式（初步）

```yaml
# example.codoc
type:
  properties:
    title: { type: string }
    count: { type: number }
    summary: { type: string }

data:
  title: "Hello CoDoc"
  count: 42
  summary:
    $ref: "/data/title"

view: |
  # {title}
  Count is **{count}**
  Summary: {summary}
```

### 关键设计决策

- `.codoc` 文件格式用 YAML front-matter 风格（type + data 是结构化的，view 是 MDX 文本）
- `useCodata(path)` 在组件 render 时触发 `observe`，如果字段是 `idle` 则触发 `force` 并 throw Promise（Suspense 接管）
- 变更循环：data 字段被外部修改 → 标脏 → 下游 invalidate → React re-render → 重新 observe → 重新 force

### 验收标准

1. 一个 `.codoc` 文件能被解析为 type + data + view 三部分
2. 渲染为浏览器中可见的页面，数据正确绑定到 MDX 模板
3. 在 devtools / 控制台中修改某个 data 字段的值，页面**自动更新**（无需手动刷新）
4. 含 `$ref` 依赖的字段：修改上游 → 下游自动重算 → 页面自动更新
5. 字段 force 期间显示 Suspense fallback（loading 状态），force 完成后替换为真实内容
6. **端到端 demo：** 一个可运行的 dev server，打开浏览器能看到渲染结果

> **M2 = MVP。** 核心等式 `observe → force → value → propagate` 完整跑通。

---

## M3 — 扩展 Loader 类型

**目标：** 支持异步外部数据源和 LLM 求值

### 技术栈

- HTTP 请求：`fetch` (native)
- LLM 调用：Anthropic SDK (`@anthropic-ai/sdk`)
- 缓存：内存 Map + TTL（M3 不需要持久化缓存）

### 模块设计

| 模块 | 职责 |
|---|---|
| `loader/source` | `$source` loader：HTTP/API 数据获取，支持 `ttl` / `stale-while-revalidate` 缓存策略 |
| `loader/prompt` | `<Prompt />` loader：LLM 调用，schema-constrained output（强制 JSON Schema 输出格式） |
| `loader/registry` | Loader 注册表：根据 meta 中的声明分发到对应 loader |
| `scheduler` | 并行调度器：同拓扑层级内的异步 loader 并发执行，带超时和错误处理 |

### 关键设计决策

- Loader 是统一接口：`(meta: CodataMeta, context: ForceContext) → Promise<T>`
- `$source` 的缓存策略声明在 meta 中：`{ $source: "https://...", ttl: 60, staleWhileRevalidate: true }`
- `<Prompt />` 使用 Anthropic Structured Output API，schema 直接从 type 定义转换
- 错误处理统一为三态：`resolved` / `error(retryable)` / `error(fatal)`
- 同拓扑层级的 loader 用 `Promise.allSettled` 并发，单个失败不阻塞同层其他节点

### 验收标准

1. `$source` loader 成功从 HTTP endpoint 获取数据并通过 schema validation
2. `$source` 的 TTL 缓存生效：TTL 内重复 observe 不发送新请求
3. `<Prompt />` loader 调用 LLM 并返回符合 schema 的结构化输出
4. 一个 `.codoc` 文件中混合使用字面量、`$ref`、`$source`、`<Prompt />`，全部正确 force 并渲染
5. 某个 loader 超时/失败时，显示错误状态，不影响其他字段的渲染
6. 同层 3 个 `$source` loader 并发执行（可通过请求时间戳验证并行性）

---

## M4 — 跨文档引用

**目标：** 文档间 codata 互相观察

### 技术栈

- 文件监听：`chokidar`（监听 `.codoc` 文件变更）
- 路径解析：自定义 resolver（类似 Node.js module resolution）

### 模块设计

| 模块 | 职责 |
|---|---|
| `resolver` | 跨文档路径解析：`[[B.codoc]].data.field` → 定位目标文件 + 路径 |
| `loader/external` | 跨文档 loader：observe 外部 `.codoc` 的 codata 字段，订阅其变更 |
| `doc-registry` | 文档注册表：管理已加载的 `.codoc` 实例，提供按路径查找 |
| `cross-doc-propagator` | 跨文档标脏：A 的字段变了 → 找到所有引用它的外部文档 → 标脏传播 |

### 关键设计决策

- 跨文档引用复用 `$ref` 语法但加前缀：`{ $ref: "[[B.codoc]]/data/name" }`
- 文档级依赖图是 relation engine DAG 的超集：节点粒度从字段提升到文件
- 懒加载：被引用的 `.codoc` 在首次 observe 时才加载和解析，不是启动时全量加载
- 文件变更触发重新解析 → 标脏 → 传播到所有依赖方

### 验收标准

1. A.codoc 通过 `$ref` 引用 B.codoc 的字段，正确 resolve 并渲染
2. 修改 B.codoc 的字段值（文件写入），A.codoc 的依赖字段自动标脏并重新 force
3. 循环跨文档引用检测：A 引用 B，B 引用 A → 抛出错误
4. 被引用的文件不存在时，显示明确错误，不 crash
5. 文档级依赖图可导出（DOT/JSON），显示哪些 `.codoc` 依赖了哪些

---

## M5 — Workspace

**目标：** 多文档协作网络

### 技术栈

- Workspace 配置：`codoc.workspace.yaml`（声明包含哪些 `.codoc`）
- 持久化：SQLite（通过 `better-sqlite3`）存储字段快照用于冷启动恢复
- 并发控制：单写多读锁（Workspace 级事务）

### 模块设计

| 模块 | 职责 |
|---|---|
| `workspace` | Workspace 生命周期管理：初始化、冷启动、热重载、关闭 |
| `global-dag` | 全局依赖图：合并所有文档的字段级 + 文档级依赖关系 |
| `snapshot` | 快照管理：force 结果持久化，冷启动时增量恢复（只重算标脏的） |
| `concurrency` | 并发控制：多个 Agent 同时写入时的冲突检测和排队 |

### 验收标准

1. `codoc.workspace.yaml` 声明 workspace 范围，启动时自动发现并加载所有 `.codoc`
2. 冷启动：首次启动全量 force，关闭后重启从快照恢复，只重算变更了的字段
3. 全局依赖图正确：workspace 内任意节点变更，正确传播到所有受影响的文档
4. 并发写入：两个 Agent 同时修改不同文档的不同字段 → 并行执行，无冲突
5. 并发写入：两个 Agent 同时修改同一字段 → 后者排队等待或收到冲突通知
6. Workspace 内新增/删除 `.codoc` 文件后，全局依赖图增量更新

---

## 里程碑依赖与推荐节奏

```
M0 (codata 内核)        ← 纯数据结构，无 UI，可快速迭代
 └→ M1 (relation engine) ← 纯算法，无 UI，可独立测试
     └→ M2 (render + MVP) ← 第一次在浏览器中看到东西跑起来
         └→ M3 (扩展 loader) ← 接入外部世界（HTTP / LLM）
             └→ M4 (跨文档)   ← 文档组网
                 └→ M5 (workspace) ← 生产级多文档管理
```

整条路径是严格线性依赖的。每个里程碑在上一个的基础上扩展，不改变已有模型——始终是同一个等式：`observe(codata) → force(deps) → value → propagate(dependents)`。

M0 和 M1 是纯后端逻辑，可以用 TDD 快速推进。M2 是第一个可见的里程碑，到这里就有了一个可 demo 的 MVP。M3 开始接入真实世界的不确定性（网络、LLM），复杂度会显著上升。
