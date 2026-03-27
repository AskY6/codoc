# Web Inspector V2 — 统一 DAG + shadcn/ui + 新人友好

## 新人视角问题诊断

### 问题 1: 右侧 DAG 碎片化，看不到因果链

现状：两个独立面板——"B.CODOC — FIELD DAG"（纯字段列表）+ "CROSS-DOC DAG"（文档节点列表）。
新人困惑："/projectName 变了 → /importedName 也变了" 这条链路在 UI 上是**断裂的**。

### 问题 2: 操作无因果反馈

按钮点击后，文档值瞬间更新，DAG 节点始终绿色。
新人困惑："我点了按钮，值变了，但 DAG 跟这件事有什么关系？"

### 问题 3: 缺少引导

页面没有标题/说明，新人不知道在看什么。两个文档面板的关系（provider/consumer）也不够显眼。

---

## 改进方案

### 1. 统一 DAG — 一张图看到全部字段和依赖

**不再分两个面板**。用一张 SVG 图展示所有文档的所有字段，包括跨文档的引用边：

```
  ┌─ B.codoc ────────────────┐        ┌─ A.codoc ──────────────────────┐
  │                          │        │                                │
  │  /projectName ───────────│───────→│ /importedName                  │
  │  /version    ────────────│───────→│ /importedVersion               │
  │  /status     ────────────│───────→│ /importedStatus                │
  │                          │        │  /title                        │
  └──────────────────────────┘        └────────────────────────────────┘
```

**数据来源（全部已有 API）：**

```typescript
// 每个文档内部的边
for (const node of dag.getNodes()) {
  for (const dep of dag.getDirectDeps(node)) {
    // edge: { from: `${docId}:${dep}`, to: `${docId}:${node}` }
  }
}

// 跨文档的边
for (const [docId, rt] of runtimes) {
  for (const dep of extractExternalDeps(rt.tree)) {
    // edge: { from: `${dep.docRef}:${dep.fieldPath}`, to: `${docId}:${dep.localPath}` }
  }
}
```

**节点状态实时着色：**
- resolved = 绿色
- dirty = 橙色
- pending = 灰色脉动
- error = 红色

**传播动画：**
当操作触发时，被修改的节点先闪烁橙色（dirty），然后沿边传播到下游节点，最终全部回到绿色（resolved）。
实现：`tree.subscribeField(path, cb)` 监听每个节点，状态变化时触发 CSS transition。

### 2. shadcn/ui 基础组件

**需要安装：**
- tailwindcss + @tailwindcss/vite
- shadcn/ui init (new York style, neutral color)

**使用的 shadcn 组件：**
- `Card` — 文档面板容器
- `Button` — 操作按钮
- `Tabs` — Render/Source 切换
- `Badge` — 节点状态标签
- `Tooltip` — 节点 hover 显示详细状态

**替换规则：**
- 删除 index.html 中所有手写 CSS class
- 所有样式用 Tailwind utility + shadcn 组件

### 3. 新人友好引导

**页面顶部加一行说明：**
> 两个 .codoc 文档通过 `$ref` 建立了跨文档引用关系。修改 B 的字段值，观察变化如何通过依赖图传播到 A。

**文档面板标注角色：**
- B.codoc → Badge: "Provider"
- A.codoc → Badge: "Consumer"

**DAG 区域标注：**
- 虚线框 = 文档边界
- 实线箭头 = 数据流向
- 边上标注引用语法（如 `$ref: [[B.codoc]]/projectName`）

---

## 实现步骤

### Step 1: 安装 Tailwind + shadcn/ui

```bash
cd apps/web
pnpm add tailwindcss @tailwindcss/vite
pnpm add tailwind-merge clsx class-variance-authority lucide-react
# shadcn init
npx shadcn@latest init
# 添加需要的组件
npx shadcn@latest add card button tabs badge tooltip
```

配置：
- vite.config.ts 加 `tailwindcss()` plugin
- tsconfig.json 加 path alias `@/*` → `./src/*`
- 创建 src/lib/utils.ts (cn helper)
- 创建 src/globals.css (Tailwind directives + shadcn CSS variables)

### Step 2: 统一 DAG 组件 (UnifiedDAG.tsx)

用 SVG 渲染：
- 从所有 runtimes 收集节点和边（内部 + 跨文档）
- 按文档分组，用虚线 `<rect>` 画文档边界
- 节点 = `<rect>` + `<text>`，颜色由 `useFieldStatus()` 驱动
- 边 = `<path>` 或 `<line>`，跨文档边用不同颜色/虚线
- CSS transition 实现状态变化动画

布局算法（简单版）：
- 文档左右排列
- 每个文档内的字段垂直排列
- 对齐有引用关系的字段到同一水平线

### Step 3: 重写 DocPanel / OpsBar 用 shadcn 组件

- DocPanel: `<Card>` + `<Tabs>` + `<Badge>`
- OpsBar: `<Button variant="outline">`
- 删除 index.html 中手写样式

### Step 4: 添加引导文案

- 页面标题 + 一句话说明
- 文档面板 Provider/Consumer badge
- DAG 图例

### Step 5: 验证

- 页面加载三区布局正确
- Render/Source 切换正常
- 统一 DAG 显示全量字段 + 跨文档边
- 点击操作按钮 → 节点变色 → 传播 → 恢复绿色
- 新人能看懂"B 的值变了 → 通过引用 → A 的值也变了"

---

## 文件变更预估

| 文件 | 变更 |
|---|---|
| apps/web/package.json | 加 tailwindcss, shadcn 依赖 |
| apps/web/vite.config.ts | 加 tailwindcss plugin, path alias |
| apps/web/tsconfig.json | 加 path alias |
| apps/web/components.json | shadcn 配置 (新) |
| apps/web/src/globals.css | Tailwind directives + CSS vars (新) |
| apps/web/src/lib/utils.ts | cn() helper (新) |
| apps/web/src/components/ui/*.tsx | shadcn 组件 (自动生成) |
| apps/web/src/UnifiedDAG.tsx | 统一 DAG SVG 组件 (新，替代 DAGPanel.tsx) |
| apps/web/src/DocPanel.tsx | 用 Card + Tabs 重写 |
| apps/web/src/OpsBar.tsx | 用 Button 重写 |
| apps/web/src/App.tsx | 新布局 + 引导文案 |
| apps/web/src/main.tsx | 引入 globals.css |
| apps/web/index.html | 删除所有手写 style，仅保留骨架 |
| apps/web/src/DAGPanel.tsx | 删除 |
