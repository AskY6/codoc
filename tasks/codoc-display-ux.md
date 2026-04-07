# Workspace Detail — Codocs 展示 UX 改进

基于用户视角分析，按优先级排列。每个任务独立可交付。

---

## P0-1: 列表显示 title 而非 path

**问题**: 列表只显示 `c.path`（如 `rss/feeds/hackernews`），忽略了 `meta.title`。Canvas panel 的 TreeItem 已经用了 `node.title ?? node.name`，两处不一致。

**改动范围**: `apps/web/src/pages/workspace-detail.tsx`

**具体做法**:
- codoc 行主文本改为 `c.meta.title ?? c.path`
- 如果有 title，将 path 作为副文本（`text-xs text-muted-foreground`）显示在下方
- 如果有 `meta.description`，也以副文本显示（单行 truncate）

**验收标准**:
- 有 title 的 codoc 显示 title + path 副文本
- 无 title 的 codoc 显示 path（行为不变）
- 列表信息密度明显提升

---

## P0-2: 整行可点击，去掉 hover-only 的 View 按钮

**问题**: View 是核心操作，但藏在 hover-only 的 opacity-0 按钮里。触屏不可用，新用户不知道存在。

**改动范围**: `apps/web/src/pages/workspace-detail.tsx`

**具体做法**:
- 整个 codoc 行改为可点击，点击触发 `handleViewCodoc(c.path)`
- 移除单独的 Eye 按钮
- New Chat 和 Delete 按钮保留 hover 显示（它们是次要操作）
- 添加 `cursor-pointer` 样式
- 行右侧保留 StatusBadge，始终可见

**验收标准**:
- 点击行任意位置打开 codoc 查看弹窗
- New Chat / Delete 仍可用，不被行点击干扰（stopPropagation）
- 触屏设备可正常查看 codoc

---

## P1-1: 用 TreeItem 替换扁平列表

**问题**: Codoc path 是层级化的（`rss/feeds/xxx`），但 workspace detail 用无分组扁平列表。Canvas panel 已有现成的 `buildTree` + `TreeItem`。

**改动范围**: `apps/web/src/pages/workspace-detail.tsx`

**具体做法**:
- import `buildTree`, `TreeItem` from `@/components/codoc-browser`
- 用 `useMemo(() => buildTree(codocs), [codocs])` 构建树
- 替换 codocs.map 扁平渲染为 `<TreeItem>` 递归渲染
- TreeItem 的 `onSelect` 回调触发 `handleViewCodoc`
- 保留或调整 New Chat / Delete 操作（可能需要扩展 TreeItem 的 props 支持 action slot）

**注意**: TreeItem 当前没有 action 按钮（New Chat / Delete）。需要评估：
- 方案 A: 给 TreeItem 加 `renderActions` slot prop
- 方案 B: 在 workspace-detail 里写一个 WorkspaceTreeItem 组件 wrap TreeItem
- 建议方案 A，因为保持组件通用性

**验收标准**:
- codocs 按目录层级分组显示
- 目录名显示为分组标题（如 `rss/`、`rss/feeds/`）
- 叶子节点显示 title + StatusBadge
- 点击叶子节点触发查看

---

## P1-2: 状态 Badge 可点击筛选

**问题**: 头部显示 `ready: 5, dirty: 2` 等统计，但不可点击。用户自然期望点击后筛选。

**改动范围**: `apps/web/src/pages/workspace-detail.tsx`

**具体做法**:
- 新增 state `filterState: string | null`
- 点击某个 status Badge 设置 `filterState`，再次点击清除
- 被激活的 Badge 样式高亮（如 `bg-primary/10`）
- 列表/树根据 `filterState` 过滤显示
- 如果是树形视图，过滤后只展示匹配的叶子节点及其祖先路径

**验收标准**:
- 点击 `dirty: 2` 后列表只显示 dirty 状态的 codoc
- 再次点击清除筛选
- 筛选时 Badge 有明确的激活态

---

## P2-1: 添加搜索框

**问题**: codocs 数量增多后无法快速定位。

**改动范围**: `apps/web/src/pages/workspace-detail.tsx`

**具体做法**:
- 在 Codocs section header 和列表之间添加搜索框
- 仅当 `codocs.length > 8` 时显示（少量 codoc 不需要搜索）
- 搜索匹配 `path` 和 `meta.title`，大小写不敏感
- 使用 `useDeferredValue` 或简单的 `useState` + filter

**验收标准**:
- 超过 8 个 codoc 时出现搜索框
- 输入关键词实时过滤列表
- 搜索清空后恢复完整列表

---

## P2-2: Graph 节点可点击

**问题**: Graph tab 是纯可视化 SVG，节点不可交互。用户只能看不能操作。

**改动范围**: `apps/web/src/components/graph-view.tsx`, `apps/web/src/pages/workspace-detail.tsx`

**具体做法**:
- GraphView 组件接受 `onNodeClick?: (path: string) => void` prop
- 每个节点 rect/text 加 `cursor-pointer` 和 click handler
- hover 时高亮节点及其直接依赖边
- workspace-detail 传入 `onNodeClick={handleViewCodoc}`

**验收标准**:
- 点击 graph 节点打开 codoc 查看弹窗
- hover 节点时有视觉反馈（高亮）
- 与 list tab 的操作体验一致

---

## P3-1: Codoc 详情路由（deep link）

**问题**: 无法分享或 bookmark 某个 codoc 的视图，没有 `/workspace/:id/codoc/:path` 路由。

**改动范围**: `apps/web/src/app.tsx`, 新建 `apps/web/src/pages/codoc-detail.tsx`

**具体做法**:
- 添加路由 `/workspace/:id/codoc/*` → CodocDetailPage
- 该页面复用 `CodocViewer` 组件，全屏展示 codoc 内容
- 页面头部：返回按钮 + codoc path + StatusBadge + New Chat 按钮
- workspace-detail 中整行点击改为 navigate 到此路由（替代 dialog）
- 保留 dialog 查看作为 Graph 节点点击的快捷方式

**验收标准**:
- `/workspace/xxx/codoc/rss/feeds/hackernews` 可直接访问
- 页面显示完整的 codoc 渲染内容
- 返回按钮回到 workspace detail
- URL 可分享、可 bookmark
