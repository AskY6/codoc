# MDX Render Engine — 从 YAML view tree 迁移到 MDX

## 背景

Codoc 定位是 lazy 数据源的公式引擎。终态渲染层是 MDX，YAML view tree 是阶段 2 的最小验证产物。MDX 天然解决两个问题：
- **compute** — JS 表达式替代 `$compute` DSL
- **view 复用** — React 组件 import

## 已完成

### Part 1：替换 render 引擎为 MDX

**Core parser** (`packages/core/src/parser/`)
- 检测 frontmatter 格式（`---` 分隔符），提取 YAML frontmatter → meta + data
- MDX body 存为 `view: { type: "mdx", source: string }`
- 传统 YAML 格式继续兼容（过渡期）
- 新增 `MdxView` 类型导出

**MDX 组件库** (`apps/web/src/components/codoc/`)
- `Timeline` — 键盘导航、已读状态、metadata 提取、action 回调
- `DataTable` — 表格渲染
- `Section` — 带标题的边框容器
- `Stack` / `Grid` — 布局组件
- `Tabs` / `Tab` — 折叠标签
- `Navigate` — 导航 action 封装
- `CodocActionsProvider` — React context 注入 onAction

**MDX Runtime** (`apps/web/src/lib/mdx-runtime.ts`)
- 浏览器端 `@mdx-js/mdx` compile + run
- `data` 通过 JSON 注入到 MDX 模块作用域
- 组件通过 `components` prop 注入

**MdxRenderer** (`apps/web/src/components/codoc/MdxRenderer.tsx`)
- 编译 + 执行 MDX，带 error boundary
- 编译错误显示错误信息而非白屏

**CodocViewer** 分流渲染
- `view.type === "mdx"` → MdxRenderer
- 否则 → 传统 ViewRenderer（过渡期兼容）

**Agent 迁移**
- `rss-agent.ts` — 系统 prompt 模板从 YAML → MDX
- `claude-code-log-agent.ts` — 系统 prompt 模板从 YAML → MDX
- `codoc-generators.ts` — 程序化生成从 YAML → MDX

### Part 2：RSS 多源聚合用例

MDX 格式的聚合 codoc 示例：

```mdx
---
meta:
  title: RSS 全源动态
  tags: [rss, dashboard]
data:
  feedA:
    $ref: "./tech.codoc#data.articles"
  feedB:
    $ref: "./design.codoc#data.articles"
---

export const allArticles = [
  ...(data.feedA ?? []).map(a => ({ ...a, feedTitle: "Tech" })),
  ...(data.feedB ?? []).map(a => ({ ...a, feedTitle: "Design" })),
].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

# RSS 全源动态

{allArticles.length} articles from 2 feeds

<Timeline items={allArticles} />
```

## 待完成

- [ ] 删除 `view-renderer.tsx`（等所有现存 YAML codoc 迁移后）
- [ ] 删除 `ViewNode` 类型、`VIEW_TYPES` 白名单、`ViewNodeRawSchema`
- [ ] MDX 编译结果缓存（按 source hash）
- [ ] RSS scheduler 生成 MDX 格式 codoc（`apps/server/src/rss-scheduler.ts`）

## 数据库

无影响。`content` 列存 MDX 字符串，`ast` 的 jsonb 内部 `view` 从 ViewNode 变为 `{ type: "mdx", source: "..." }`。
