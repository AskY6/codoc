# CoDoc Components — Implementation Roadmap

基于 CODOC_COMPONENT.md 的设计修订，从当前 `{ type, data, view }` 演进到 `{ meta, data, components, view }` 四部分结构。

---

## 现状

当前 CodocFile 结构：

```typescript
CodocFile = { type, data, view }
```

- `type`：JSON Schema，描述 data 的结构
- `data`：字段值 + loader 声明（literal / $ref / $source / $prompt / external）
- `view`：MDX 模板字符串

组件在 MDX 中隐式使用（如 `<CodataValue>`），无显式声明。Render 包仅有 stubs。

---

## Phase 0：Meta 层升级

**目标：** `type` → `meta.data`，为后续 `meta.components` 和 `meta.view` 预留结构。

**改动范围：** `@codoc/core`, `@cobook/workspace`

### 任务

1. **核心类型变更** — `packages/core/src/model/codoc.ts`
   - `CodocFile` 新增 `meta` 字段：`{ data?: JsonSchema, components?: ComponentsMeta, view?: unknown }`
   - `type` 字段标记为 deprecated，保留为 `meta.data` 的 alias
   - 运行时读取优先取 `meta.data`，fallback 到 `type`

2. **工厂适配** — `packages/workspace/src/lifecycle/codoc-factory.ts`
   - 解析 YAML 时：遇到 `type` 自动提升为 `meta.data`
   - 支持新格式直接声明 `meta:`

3. **FieldMeta 对齐** — `packages/workspace/src/api/types.ts`
   - `DocMeta.schema` 改从 `meta.data` 读取
   - API 响应格式保持兼容

4. **Skill 适配** — `packages/workspace/src/skill/claude-code-log.ts`
   - `mapToCodoc` 输出改用 `meta.data` 格式

5. **Agent 上下文** — `apps/cobook/src/agents/codoc-agent.ts`
   - 系统提示词中 `type` 引用改为 `meta.data`

### 完成标准

- 新旧格式 codoc 均可正确加载
- 所有现有 API 行为不变
- 新建 codoc 默认使用 `meta` 格式

---

## Phase 1：Components Meta — 签名 + 语义

**目标：** codoc 显式声明自己使用了哪些组件，每个组件的 props 签名和语义描述。

**改动范围：** `@codoc/core`, `@cobook/workspace`

### 任务

1. **组件签名类型** — `packages/core/src/model/component.ts`（新文件）
   ```typescript
   interface PropMeta {
     type: string
     description?: string
   }

   interface ComponentSignature {
     props: Record<string, PropMeta>
     description?: string
   }

   type ComponentsMeta = Record<string, ComponentSignature>
   ```

2. **CodocFile 接入** — `packages/core/src/model/codoc.ts`
   - `meta.components: ComponentsMeta`

3. **验证** — `packages/core/src/validation/`
   - 新增 `component-validator.ts`：校验 view 中引用的组件是否在 `meta.components` 中声明
   - 校验 props 使用是否符合签名

4. **Agent 上下文增强** — `apps/cobook/src/agents/codoc-agent.ts`
   - 生成 view 时，将 `meta.data`（有什么数据）和 `meta.components`（有什么 UI 能力）同时注入 prompt
   - Agent 据此生成合法的 MDX

5. **Workspace API 暴露** — `packages/workspace/src/api/`
   - `DocMeta` 新增 `components: ComponentsMeta`
   - API 返回组件信息

### 完成标准

- codoc 可声明 `meta.components`
- Agent 生成 view 时能感知可用组件
- 校验器能检查 view 与组件签名的一致性

---

## Phase 2：Components 本体 — Bundle 引用

**目标：** codoc 声明组件的实际来源（bundle 引用），运行时能解析到可执行代码。

**改动范围：** `@codoc/core`, `@codoc/render`

### 任务

1. **引用类型定义** — `packages/core/src/model/component.ts`
   ```typescript
   type ComponentRef =
     | { from: string }                           // workspace://lib/Name
     | { bundle: string }                          // 本地 bundle 路径
     | { bundle: string; version: string }         // registry://pkg/Name@version

   interface ComponentDeclaration {
     ref: ComponentRef
     // meta 可从 workspace 组件库继承，无需重复声明
   }

   type ComponentsBody = Record<string, ComponentDeclaration>
   ```

2. **CodocFile 接入**
   - 新增顶层 `components: ComponentsBody`
   - 与 `meta.components` 互补：`meta` 是签名，`components` 是实现

3. **Bundle 解析器** — `packages/render/src/bundle-resolver.ts`（新文件）
   - `workspace://` → 从 workspace 组件库加载
   - `./path` → 从 codoc 相对路径加载本地 bundle
   - `registry://` → 从远程 registry 加载（锁版本）

4. **渲染注入** — `packages/render/src/`
   - MDX 编译时将 `components` 声明注入组件 scope
   - 渲染时只有声明过的组件可用，未声明的组件报错

### 完成标准

- 三种引用方式（workspace / local / registry）均可解析
- MDX 渲染只使用 codoc 显式声明的组件
- 远程 bundle 强制锁版本

---

## Phase 3：Workspace 组件库

**目标：** Workspace 级共享组件集合，codoc 通过轻量引用复用，不重复声明签名。

**改动范围：** `@cobook/workspace`, `apps/cobook`

### 任务

1. **组件库数据模型** — `packages/workspace/src/component-library/`（新目录）
   ```typescript
   interface WorkspaceComponent {
     name: string
     signature: ComponentSignature    // props + description
     bundle: ComponentRef             // source of truth
   }

   interface ComponentLibrary {
     register(component: WorkspaceComponent): void
     get(name: string): WorkspaceComponent | undefined
     list(): WorkspaceComponent[]
   }
   ```

2. **Meta 继承机制**
   - codoc 引用 `{ from: "workspace://ui-kit/Chart" }` 时，`meta.components.Chart` 自动从组件库继承
   - codoc 无需（也不应）重复写签名
   - 本地 / 远程 bundle 仍需自行声明 meta

3. **Workspace API 扩展**
   - `GET /api/components` — 列出组件库
   - `GET /api/components/:name` — 组件详情（签名 + bundle）

4. **UI** — `apps/cobook/src/workspace/components/`
   - 组件库浏览面板
   - codoc 编辑时可从组件库选取组件

### 完成标准

- Workspace 拥有共享组件库
- codoc 引用 workspace 组件时自动继承签名
- Agent 可查询组件库获取可用组件列表

---

## Phase 4：Render 引擎完成

**目标：** `@codoc/render` 从 stub 变为可用的 MDX 渲染引擎。

**改动范围：** `@codoc/render`

### 任务

1. **MDX 编译管线** — `packages/render/src/compiler.ts`
   - 集成 `@mdx-js/mdx`
   - 输入：view（MDX 字符串）+ components（声明）+ data（解析后的值）
   - 输出：可执行的 React 组件

2. **组件 Scope 注入**
   - 从 `components` 声明解析 bundle → 注入 MDX scope
   - 内建组件（`<CodataValue>` 等）始终可用

3. **Data 绑定**
   - MDX 模板中可通过 `{data.fieldName}` 访问解析后的字段值
   - 响应式：字段值变化时触发重渲染

4. **错误边界**
   - 组件渲染失败不崩溃整个 view
   - 未声明组件 → 友好错误提示

### 完成标准

- MDX 模板可正确编译和渲染
- 组件 scope 来自 codoc 显式声明
- Data 绑定响应式工作

---

## Phase 5：静态兼容性检查

**目标：** 组件签名变更时，静态检查依赖该组件的 codoc view 是否仍然兼容。

**改动范围：** `@cobook/workspace`

### 任务

1. **变更检测** — `packages/workspace/src/component-library/compat.ts`
   - 对比新旧 `ComponentSignature`
   - Breaking change 判定：新增必填 prop、删除 prop、prop 类型变更
   - Non-breaking：新增可选 prop、description 变更

2. **影响分析**
   - 给定一个组件签名变更，找出所有引用该组件的 codoc
   - 逐个检查 view 中对该组件的使用是否仍合法

3. **检查时机**
   - 组件库注册/更新时触发
   - Codoc 加载时校验
   - **不走 DAG 标脏传播**——这是 meta 层静态检查，非 value 层运行时传播

4. **报告**
   - 兼容性检查结果通过 Workspace API 暴露
   - UI 展示不兼容的 codoc 列表

### 完成标准

- 组件签名变更自动触发兼容性扫描
- Breaking change 产生明确警告
- 检查在 meta 层完成，不干扰 value 层运行时

---

## 依赖关系

```
Phase 0 (Meta 层)
  │
  ├── Phase 1 (Components Meta)
  │     │
  │     └── Phase 2 (Bundle 引用)
  │           │
  │           ├── Phase 3 (Workspace 组件库)
  │           │
  │           └── Phase 4 (Render 引擎)
  │                 │
  │                 └── Phase 5 (兼容性检查) ← 也依赖 Phase 3
  │
  (Phase 3 和 Phase 4 可并行)
```

## 优先级建议

| Phase | 价值 | 风险 | 建议 |
|-------|------|------|------|
| 0 | 基础必要，unblock 后续所有 Phase | 低（兼容性变更） | 立即开始 |
| 1 | Agent 生成 view 质量显著提升 | 低 | 紧跟 Phase 0 |
| 2 | 组件从隐式变显式，渲染可控 | 中（bundle 解析复杂度） | Phase 1 后 |
| 3 | 跨 codoc 复用组件 | 中 | 可与 Phase 4 并行 |
| 4 | view 真正可渲染 | 高（MDX 集成有未知量） | 可与 Phase 3 并行 |
| 5 | 安全网 | 低 | 最后做 |
