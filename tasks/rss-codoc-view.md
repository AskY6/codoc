# RSS × Codoc View — 从对话流到阅读面板

## 背景

RSS agent 当前的数据链路是：fetch feed → 对话中展示 → 用户说"沉淀"→ 存 codoc。问题是对话中的信息转瞬即逝，而存下来的 codoc 只是一篇静态笔记，没有利用 view 系统做结构化呈现。

codoc 已有的 view 能力（timeline / tabs / table / markdown / section）天然适合 RSS 阅读场景。如果让 agent 把 feed 数据写入 codoc 的 `data`，再定义好 `view`，就能在 canvas 面板中呈现一个 **只读型 RSS 阅读面板**——不需要新增 view 组件，用现有积木即可拼出来。

---

## 目标

用户在 chat 中管理订阅、触发刷新；canvas 右侧面板像 RSS reader 一样展示 feed 内容。数据通过 codoc 持久化，跨会话可用。

---

## P0: 单 Feed → Codoc 沉淀

### 问题

当前 `createCodoc` 只存摘要文本，没有结构化数据，view 也是空的。

### 设计

Agent 在写 codoc 时，按照约定结构组织 `data` 和 `view`：

**Codoc 结构：**
```yaml
meta:
  title: "Hacker News Best"
  tags: [rss, tech]
  description: "https://hnrss.org/best"

data:
  feedTitle: "Hacker News Best"
  feedUrl: "https://hnrss.org/best"
  lastFetchedAt: "2026-04-03T10:00:00Z"
  articles:
    - title: "Why SQLite is taking over"
      link: "https://example.com/sqlite"
      pubDate: "2026-04-02"
      summary: "SQLite 正在从嵌入式数据库演变为通用数据引擎..."
      isNew: true
    - title: "Rust in the Linux kernel"
      link: "https://example.com/rust"
      pubDate: "2026-04-01"
      summary: "内核社区对 Rust 的态度正在转变..."
      isNew: false

view:
  type: stack
  children:
    - type: section
      props:
        title: null
      children:
        - type: text
          bind: data.feedTitle
        - type: text
          bind: data.lastFetchedAt
    - type: timeline
      children:
        - type: section
          props:
            title: "Why SQLite is taking over"
          children:
            - type: text
              props:
                content: "2026-04-02 · 🆕"
            - type: markdown
              props:
                content: "SQLite 正在从嵌入式数据库演变为..."
```

**问题：** 现有 view 系统 `timeline` 的 children 是静态声明的，不能对 `data.articles` 数组做 for-each 渲染。这意味着每篇文章都要在 view YAML 中硬编码为一个 child。

**两种处理方式：**

A. **Agent 生成展开后的 view** — agent 在调用 `createCodoc` / `updateCodoc` 时，根据文章数量直接生成完整的 view YAML（每篇文章一个 section child）。不需要改 view 系统，但 view YAML 会较长。

B. **View 支持数组绑定 + repeat** — 给 view 加一个 `repeat` 语义，让 timeline/stack 能绑定数组并对每个元素渲染 template。这是通用能力提升，但改动更大。

**建议 P0 先用方式 A**，agent 生成展开的 view。验证链路跑通后再考虑方式 B。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `packages/agent/src/rss-agent.ts` | system prompt 新增"沉淀为 codoc 时按约定结构生成 data + view YAML"的指令 |

纯 prompt 工程，不改代码。Agent 基于 system prompt 中的模板生成 codoc YAML。

---

## P1: Feed Dashboard — 多 Feed 聚合视图

### 问题

用户订阅多个 feed 后，每个 feed 是独立的 codoc。缺少一个汇总面板。

### 设计

引入一个 dashboard codoc，通过 `$ref` 聚合多个 feed codoc 的数据：

```yaml
# rss/dashboard.codoc
meta:
  title: "My RSS Dashboard"
  tags: [rss, dashboard]

data:
  techArticles:
    $ref: "rss/tech-weekly.codoc#data.articles"
  designArticles:
    $ref: "rss/design-digest.codoc#data.articles"

view:
  type: tabs
  children:
    - type: stack
      props:
        label: "Tech"
      children:
        # agent 展开 techArticles 为 timeline children
    - type: stack
      props:
        label: "Design"
      children:
        # agent 展开 designArticles 为 timeline children
```

**关键：`$ref` 让 DAG 引擎自动建立依赖。** 当某个 feed codoc 的 data 更新后，dashboard 节点状态变为 dirty，下次 resolve 自动拿到最新数据。

**问题：** dashboard 的 view 也需要跟着数据变化重新生成（因为 P0 用的是方式 A —— 展开式 view）。这需要 agent 在更新 feed codoc 后也同步更新 dashboard 的 view。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `packages/agent/src/rss-agent.ts` | system prompt 新增 dashboard 管理指令：首次订阅时创建 dashboard codoc；刷新 feed 后同步更新 dashboard view |

仍然是 prompt 工程为主。Agent 需要理解 dashboard 的 `$ref` 结构并正确生成/更新它。

---

## P2: View Repeat — 数组绑定渲染

### 问题

方式 A（agent 展开 view）可以工作，但有两个弊端：
1. view YAML 随文章数线性膨胀（20 篇文章 = 20 个 section 节点）
2. 数据更新后必须同步重写 view，否则展示过时

### 设计

给 ViewNode 新增 `repeat` 语义，让容器节点能绑定数组并循环渲染模板：

```yaml
view:
  type: timeline
  repeat:
    bind: data.articles      # 绑定到数组
    as: item                 # 循环变量名
  template:
    type: section
    props:
      title: "{{item.title}}"
    children:
      - type: text
        props:
          content: "{{item.pubDate}}"
      - type: markdown
        props:
          content: "{{item.summary}}"
```

**前端改动：**

```typescript
// apps/web/src/types.ts
interface ViewNode {
  type: string;
  props?: Record<string, unknown>;
  children?: ViewNode[];
  bind?: string;
  repeat?: {
    bind: string;    // 指向数组的 data path
    as: string;      // 模板变量名
  };
  template?: ViewNode;  // repeat 模式下的子模板
}
```

**渲染逻辑（view-renderer.tsx）：**
- 如果节点有 `repeat`，从 data 中 resolve 出数组
- 对数组每个元素，实例化 `template`，将 `{{item.xxx}}` 替换为实际值
- 生成动态 children，交给原有渲染逻辑

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/web/src/types.ts` | ViewNode 新增 `repeat` 和 `template` 字段 |
| `apps/web/src/components/view-renderer.tsx` | 渲染前检测 repeat → 展开为动态 children |
| `packages/agent/src/rss-agent.ts` | system prompt 改用 repeat 语法，view 大幅简化 |

---

## P3: 刷新链路 — Chat 触发 Codoc 更新

### 问题

用户说"刷新 tech feed"时，agent 需要：fetch 最新 feed → 更新对应 codoc 的 data → 如果用方式 A 还要更新 view。

### 设计

**刷新流程：**
```
用户："刷新 tech feed"
  → agent 调 fetchRssFeed 拿最新数据
  → agent 调 updateCodoc 更新 rss/tech-weekly.codoc 的 data（如 P0-A 则也更新 view）
  → DAG 引擎标记 dashboard 为 dirty
  → 前端自动 re-fetch codoc 详情，view 刷新
```

**关键约束：**
- agent 必须知道 feed URL 和 codoc path 的映射关系
- 方式 A：description 字段存 feed URL，agent 用 `listCodocs` 找到对应 codoc
- 方式 B（P2 之后）：只需更新 data，view 自动跟随

**改动范围：**

| 文件 | 改动 |
|------|------|
| `packages/agent/src/rss-agent.ts` | system prompt 新增刷新指令："刷新"→ fetch feed → 找到对应 codoc → updateCodoc |

---

## 依赖关系

```
P0 (单 feed codoc)        ← 纯 prompt 工程，可立即做
P1 (dashboard 聚合)       ← 依赖 P0 的 codoc 结构约定
P2 (view repeat)          ← 独立的前端能力，但 RSS 是第一个受益者
P3 (刷新链路)             ← 依赖 P0；P2 完成后刷新更简单
```

建议顺序：P0 → P3 → P1 → P2。先跑通单 feed 的沉淀和刷新，再做聚合和 view 能力升级。

---

## 不做的事情

- **不做 view 交互**（点击展开全文、标记已读）— 需要 view 事件系统，是更大的架构升级，留给后续 phase
- **不做定时自动刷新** — 没有 scheduler 基础设施，当前靠用户在 chat 中触发
- **不做自定义 RSS view 组件**（如 `type: "rss-card"`）— 用现有积木拼，不引入领域专用组件
- **不做 feed codoc 自动创建** — 用户明确说"订阅"时才创建，不在每次 fetch 时自动落盘
