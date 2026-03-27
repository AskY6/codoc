# Web Inspector UI — 三区布局

## 目标

将当前 M4 demo 页面升级为 CoDoc Inspector：文档展示 + 依赖关系可视化 + 操作面板，三个区域联动。

## 布局

```
┌─────────────────────────────────────────────────────────┐
│  [C] 操作面板 (顶部固定)                                  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ update  │ │ update   │ │ update   │ │  forceAll() │  │
│  │ /projec │ │ /version │ │ /status  │ │             │  │
│  └─────────┘ └──────────┘ └──────────┘ └─────────────┘  │
├──────────────────────────────┬──────────────────────────┤
│  [A] 文档展示区               │  [B] DAG 展示区           │
│                              │                          │
│  ┌────────────────────────┐  │  ┌──────────────────────┐│
│  │ B.codoc (Provider)     │  │  │  Intra-doc DAG       ││
│  │ [Render] [Source]      │  │  │  (当前选中文档)        ││
│  │                        │  │  │                      ││
│  │ 渲染态 / 原文态         │  │  │  /title ──→ /derived ││
│  │                        │  │  │                      ││
│  └────────────────────────┘  │  └──────────────────────┘│
│  ┌────────────────────────┐  │  ┌──────────────────────┐│
│  │ A.codoc (Consumer)     │  │  │  Cross-doc DAG       ││
│  │ [Render] [Source]      │  │  │                      ││
│  │                        │  │  │  B.codoc ──→ A.codoc ││
│  │ 渲染态 / 原文态         │  │  │                      ││
│  └────────────────────────┘  │  └──────────────────────┘│
└──────────────────────────────┴──────────────────────────┘
```

## [A] 文档展示区

### 现状

- 每个 `.codoc` 用 `CodataProvider` + MDX `evaluate()` 渲染
- 只有渲染态，没有源码展示

### 需要做的

**A1. 视图模式切换**

每个文档面板的 header 加两个 tab 按钮：`Render` / `Source`。

- **Render 态**（默认）：当前的 MDX 渲染结果，保持不变
- **Source 态**：展示原始 `.codoc` YAML 文本，语法高亮可选（首版纯 `<pre>` 足够）

数据来源：`.codoc?raw` import 已经有原始字符串（`docASource` / `docBSource`），直接用。

```tsx
// 每个文档面板内部的状态
const [mode, setMode] = useState<"render" | "source">("render");

// 渲染
{mode === "render" ? (
  <CodataProvider tree={rt.tree} dag={rt.dag}>
    <Suspense fallback={...}><MDXContent components={{ CodataValue }} /></Suspense>
  </CodataProvider>
) : (
  <pre className="codoc-source">{rawSource}</pre>
)}
```

**A2. 选中态**

点击某个文档面板，使其成为「选中态」（加个高亮边框）。选中文档决定 [B] 区域 Intra-doc DAG 展示的是哪个文档的内部依赖。

```tsx
const [selectedDoc, setSelectedDoc] = useState<string>("B.codoc");
```

## [B] DAG 展示区

### 两个子面板

**B1. Intra-doc DAG — 当前选中文档的内部依赖图**

数据来自 `DAG` 实例（每个 `CodocRuntime` 都有 `.dag`）：
- `dag.getNodes()` — 所有字段路径
- `dag.getDirectDeps(node)` — 每个节点的上游依赖
- `dag.getDependents(node)` — 每个节点的下游消费者

可视化方案（按优先级）：
1. **首版 — 纯 HTML 列表**：按 topoLayers 分层展示，每层一行，箭头用文本 `→` 表示。简单，零依赖。
2. **增强 — SVG 绘制**：用简单的 SVG `<line>` + `<rect>` 手绘 DAG。仍然零依赖。
3. **终态 — Graphviz / d3-dag**：用 `dag.toDot()` 输出 + `@viz-js/viz` 渲染，或 `d3-dag` 做力导向。需引入依赖。

节点需标注字段状态：
- 已 resolve ✓（绿）
- dirty（橙）
- error（红）
- pending（灰/动画）

状态信息来自 `tree.getField(path)?.state.status`。

**B2. Cross-doc DAG — 文档间依赖关系**

数据来自 `buildDocDAG(registry)`，已导出，返回 `{ nodes, edges }`。

可视化方案同上。首版用 HTML 列表足够（文档数量少）：
```
B.codoc ──→ A.codoc
        (provides: /projectName, /version, /status)
```

边上可以标注具体引用了哪些字段（来自 `extractExternalDeps(tree)`）。

### 联动行为

操作按钮点击后，DAG 区域需要反映变化：
- 被修改的字段节点闪烁/高亮
- dirty 传播路径短暂高亮（从源字段到下游字段）
- 字段状态颜色实时更新（pending → resolved）

实现方式：`tree.subscribeField(path, cb)` 已支持按字段订阅，DAG 可视化组件内部用 `useSyncExternalStore` 监听每个节点的状态变化。

## [C] 操作面板

### 现状

底部四个按钮，硬编码 action。

### 需要做的

**C1. 移到顶部**，水平排列，固定在文档区和 DAG 区之上。

**C2. 操作同时影响 [A] 和 [B]**

这一点已经天然成立：
- 按钮调用 `multi.update(docId, path, value)` → 更新 DataTree → 触发 `subscribeField` 回调
- [A] 区的 `useCodata` hook 通过 `useSyncExternalStore` 自动 re-render
- [B] 区的 DAG 可视化通过同样的订阅机制收到状态变更

关键点：不需要额外的 event bus，现有的 `tree.subscribeField` 就是联动通道。

**C3. 可扩展操作**（可选，非首版必须）

- 自定义 update：下拉选文档 + 输入字段路径 + 输入值
- reset：重新 parse `.codoc` 原文恢复初始状态
- 高亮 dirty 路径：点击后在 DAG 区标记当前所有 dirty 字段

## 实现步骤

### Step 1: 组件拆分

当前所有逻辑在 `main.tsx` 的 `boot()` 中。需要拆成 React 组件：

```
main.tsx          — boot() 创建 MultiDocRuntime，传入 App
App.tsx           — 三区布局壳，管理 selectedDoc 状态
DocPanel.tsx      — 单文档面板，含 render/source 切换
IntraDocDAG.tsx   — 内部 DAG 可视化
CrossDocDAG.tsx   — 文档间 DAG 可视化
OpsBar.tsx        — 操作按钮栏
```

### Step 2: DocPanel render/source 切换

- 实现 `[Render]` / `[Source]` tab 按钮
- Source 态用 `<pre>` 展示 raw `.codoc` 字符串
- Render 态保持当前 MDX 逻辑不变

### Step 3: DAG 可视化（首版 HTML 列表）

- IntraDocDAG：用 `topoLayers(dag)` 分层，每层一行节点，节点间用箭头连接，颜色反映状态
- CrossDocDAG：`buildDocDAG(registry)` 输出 nodes + edges，简单列表渲染
- 节点订阅 `tree.subscribeField` 实时更新状态颜色

### Step 4: 联动

- OpsBar 按钮触发 `multi.update()` 后，[A] 和 [B] 通过已有订阅自动更新
- 选中文档（点击 DocPanel）切换 IntraDocDAG 的数据源

### Step 5: 样式和布局

- CSS Grid 三区布局
- 响应式：窄屏时上下堆叠
- DAG 节点状态颜色统一规范：resolved=#d4edda, dirty=#fff3cd, error=#f8d7da, pending=#e2e3e5

## 已有能力盘点

| 需要 | 现有 API | 状态 |
|---|---|---|
| 文档原文 | `.codoc?raw` Vite import | ✅ 已有 |
| 内部 DAG 结构 | `dag.getNodes()`, `getDirectDeps()`, `getDependents()` | ✅ 已有 |
| 内部 DAG 分层 | `topoLayers(dag)` | ✅ 已有 |
| 内部 DAG → DOT | `dag.toDot({ highlightDirty })` | ✅ 已有 |
| 跨文档 DAG | `buildDocDAG(registry)` → `{ nodes, edges }` | ✅ 已有 |
| 跨文档 DAG → DOT | `docDAGtoDot(registry)` | ✅ 已有 |
| 字段级外部依赖 | `extractExternalDeps(tree)` → `ExternalDep[]` | ✅ 已有 |
| 字段状态订阅 | `tree.subscribeField(path, cb)` | ✅ 已有 |
| 字段状态读取 | `tree.getField(path)?.state.status` | ✅ 已有 |
| 跨文档更新+传播 | `multi.update(docId, path, value)` | ✅ 已有 |

结论：核心所需的数据和订阅 API 全部就绪，**纯前端工作**，不需要改 `@codoc/core`。
