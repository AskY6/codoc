# Codoc Local — 个人知识库

## 1. 目标

把 codoc 做成一个 **local-first 的个人知识库**，核心定位：

> 文件即知识，AI 可接入，数据可计算。

与 Obsidian 的关系是**同构增强**——保留"vault 即文件夹、纯本地、git 友好"的模型，在此之上叠加 Obsidian 不具备的能力：

| 能力 | Obsidian | Codoc Local |
|------|----------|-------------|
| 文档格式 | Markdown | MDX（Markdown + JSX 组件） |
| 文档间引用 | `[[wikilink]]`，纯导航 | `$ref`，引用的是**数据字段**，可求值 |
| 结构化数据 | frontmatter 只做元数据 | frontmatter 里的 `data` 块是可计算的：静态值、跨文档引用、外部数据源 |
| 数据依赖 | 无 | DAG 自动构建，拓扑排序，循环检测 |
| AI 接入 | 插件生态，各插件各自为政 | MCP 原生协议，AI client 可并行操作同一个知识库 |
| 渲染 | Obsidian 私有渲染器 | 自带 local web UI + 编译为标准 MDX |

**不做什么：**

- 不做云同步 — git 是同步层
- 不做多人协作 — 那是 server/web 线的事
- 不做插件市场 — source provider 是扩展点，但不做生态

## 2. 产品形态

### 2.1 架构

```
┌──────────┐                              ┌──────────┐
│  浏览器   │─── HTTP ──┐                  │ AI Client│
│  (UI)    │           │                  │ (Claude  │
│  纯操作   │           ▼                  │  Code等) │
└──────────┘     ┌───────────┐            └────┬─────┘
                 │  codoc    │                 │
                 │  引擎     │◀──── MCP ───────┘
                 │           │
                 └─────┬─────┘
                       │
                   文件系统
                       │
                 ┌─────▼─────┐
                 │  .codoc/  │
                 │  (vault)  │
                 └───────────┘
```

两条通道操作同一个知识库，互不感知：
- **浏览器 UI** — 纯知识库操作，不涉及 AI
- **MCP** — AI client 的接入点，与 UI 并行

### 2.2 CLI

```
codoc                # 启动 local server（含 UI）+ watch + MCP
codoc init           # 初始化知识库
codoc compile        # 一次性编译
codoc dag            # 打印依赖关系图
```

`codoc`（零参数）是主入口，等同于 Obsidian 双击打开 vault：
- 启动 local web server，浏览器自动打开知识库 UI
- 后台 watch `.codoc/` 目录，文件变更实时反映到 UI
- 同时启动 MCP server，AI client 可随时连接

### 2.3 Local Web UI

浏览器中的知识库界面，纯操作，不涉及 AI：

- **文件树** — 浏览 `.codoc/` 目录结构，创建/重命名/删除
- **编辑器** — 编辑 `.codoc` 文件（frontmatter + MDX body）
- **渲染视图** — MDX 渲染后的文档，JSX 组件正常展示
- **数据面板** — data 字段的解析状态（static / $ref / $source），引用是否解析成功
- **图谱视图** — DAG 可视化，文档间数据依赖关系

### 2.4 目录结构

```
my-knowledge-base/
├── .codoc/                    # 源文件（vault）
│   ├── components/            # 自定义 JSX 组件
│   │   └── ScoreCard.tsx
│   ├── projects/
│   │   ├── codoc.codoc
│   │   └── side-project.codoc
│   ├── notes/
│   │   ├── 2026-04-21.codoc
│   │   └── architecture-patterns.codoc
│   └── reviews/
│       ├── alice-q1.codoc
│       └── calibration.codoc
├── codoc.config.json           # 配置
└── .git/
```

### 2.5 文档格式

`.codoc` 文件 = YAML frontmatter + MDX body：

```mdx
---
title: "Q1 绩效校准"
tags: [review, q1-2026]
data:
  alice_score:
    $ref: "./alice-q1.codoc#data.weighted_total"
  bob_score:
    $ref: "./bob-q1.codoc#data.weighted_total"
  market_data:
    $source: http-json
    url: "https://api.example.com/compensation-bands"
---

<CalibrationMatrix
  scores={[data.alice_score, data.bob_score]}
  bands={data.market_data}
/>
```

三种数据字段：

- **static** — 直接写值：`score: 4`
- **$ref** — 引用另一个 codoc 的字段：`$ref: "./other.codoc#data.field"`
- **$source** — 从外部拉取数据：`$source: http-json`

### 2.6 组件系统

codoc 的 MDX 渲染依赖 JSX 组件。组件系统分为两层：

**内建组件** — codoc 自带一套通用组件（Table、Card、Chart、Badge、Progress 等），覆盖常见的数据展示场景，用户开箱即用。

**自定义组件** — 用户在 `.codoc/components/` 下编写 `.tsx` 文件，知识库自包含，git 一起管理。

#### 组件发现机制

用户不需要主动意识到"我需要一个组件"。引擎在渲染时检测文档状态，主动推荐：

```
用户写 markdown
  → 添加了 data 字段
    → 引擎检测到 data 字段只做了纯文本插值 {data.xxx}
      → UI 提示"这些数据可以用 <ScoreCard> 展示"
        → 用户选择内建组件插入
          → 不满足时，去 .codoc/components/ 写自定义组件
```

| 阶段 | 谁负责 | 机制 |
|------|--------|------|
| **发现** | 引擎 + UI | 检测到 data 字段时，主动推荐适配的内建组件 |
| **选择** | 用户 | 在组件面板里挑选，插入到 MDX body |
| **不满足** | 用户自己判断 | 内建组件不够用，想要不同的视觉表达 |
| **创建** | 用户 / AI | 在 `.codoc/components/` 里写自定义 `.tsx` |

发现是入口，创建是兜底。两条路径互不依赖，可以分别建设。

### 2.7 MCP 接口

AI client 通过 MCP 协议操作知识库，暴露的工具：

| Tool | 作用 |
|------|------|
| `list_codocs` | 列出知识库中所有 codoc |
| `read_codoc` | 读取指定 codoc 的内容和解析后的数据 |
| `write_codoc` | 创建或修改 codoc（自动解析、校验） |
| `search_codocs` | 按标题 / 标签 / 内容搜索 |
| `get_dag` | 获取数据依赖关系图 |

MCP 操作的文件和 UI 操作的文件是同一份。watch 引擎保证两边的变更都能实时反映。

## 3. 用户使用方式

### 场景 A：日常知识管理（UI）

```bash
cd my-knowledge-base
codoc
# 浏览器打开 → 看到文件树、文档列表
```

在 UI 中：
1. 点击 "新建" 创建 `.codoc` 文件
2. 在编辑器中写内容（frontmatter + MDX）
3. 切换到渲染视图，看到 JSX 组件渲染后的文档
4. 在数据面板中确认 $ref 引用是否解析成功

### 场景 B：AI 辅助（MCP，与 UI 并行）

用户在 Claude Code 中操作同一个知识库：

```
> "帮我整理一份本周的项目进展笔记"
> "calibration 表里 Alice 的评分是多少？"
> "创建一个新的 codoc，记录今天的 API 设计决策"
```

AI 通过 MCP 读写 `.codoc` 文件。如果 UI 同时打开着，文件变更实时刷新。

### 场景 C：跨文档数据联动

创建一组相互引用的 codoc：

```
reviews/alice-q1.codoc     →  data: { weighted_total: 3.95 }
reviews/bob-q1.codoc       →  data: { weighted_total: 4.10 }
reviews/calibration.codoc  →  data: { alice: $ref alice, bob: $ref bob }
```

无论通过 UI 还是 MCP 修改 `alice-q1.codoc` 的评分：
1. watch 检测到文件变更
2. DAG 重建，发现 `calibration.codoc` 依赖 `alice-q1.codoc`
3. `calibration.codoc` 自动重新求值
4. UI 中的渲染视图和数据面板实时更新

### 场景 D：组件渐进使用

1. 用户写了一份 review codoc，frontmatter 有 `data: { score: 4 }`，body 里写 `评分：{data.score}`
2. UI 渲染视图下方出现提示："data.score 可以用 `<Badge>` 或 `<Progress>` 组件展示"
3. 用户点击 `<Progress>`，body 自动替换为 `<Progress value={data.score} max={5} />`
4. 后来用户想要一个带雷达图的评分卡，内建组件没有
5. 用户（或通过 AI）在 `.codoc/components/RadarCard.tsx` 写一个自定义组件
6. 回到 codoc 中使用 `<RadarCard scores={data} />`

### 场景 E：版本管理

```bash
# 知识库就是一个 git 仓库（包括自定义组件）
git add .codoc/
git commit -m "add Q1 review codocs"
git push
```

## 4. Roadmap

### Phase 0 — 引擎夯实

当前 `apps/local` 已有 watch / compile / MCP / DAG 能力。这个阶段补齐引擎层的基础：

- [ ] `codoc init` — 初始化知识库目录结构（`.codoc/`、`codoc.config.json`）
- [ ] `codoc`（零参数）统一入口 — 启动 local server + watch + MCP，一个命令全部拉起
- [ ] WebSocket 变更推送 — watch 检测到文件变更后通知前端实时刷新

### Phase 1 — 最小可用 UI

目标：用户能在浏览器里浏览和编辑知识库，替代"编辑器 + MDX 预览插件"。

- [ ] Local HTTP server（Hono），serve 前端 + 提供 API
- [ ] 文件树侧边栏 — 读取 `.codoc/` 目录，展示树形结构
- [ ] 文档列表 + 基础导航
- [ ] 编辑器视图 — 纯文本编辑 `.codoc` 文件，保存写回文件系统
- [ ] 渲染视图 — 将 MDX body 渲染为 HTML（仅 markdown，暂无自定义组件）
- [ ] data 面板 — 展示解析后的 data 字段及 $ref 解析状态

### Phase 2 — 内建组件

目标：MDX 渲染能力从"markdown 文本"升级到"数据驱动的组件化展示"。

- [ ] 内建组件库 — Table、Card、Badge、Progress、Chart 等通用组件
- [ ] 组件注册表 — 运行时发现并注入可用组件到 MDX 渲染器
- [ ] 组件面板 — UI 侧边栏列出所有可用组件，点击插入模板代码
- [ ] 组件推荐 — 引擎检测 data 字段的类型和使用方式，主动推荐适配组件

### Phase 3 — 自定义组件

目标：用户能创建自己的组件，知识库自包含。

- [ ] `.codoc/components/*.tsx` 加载 — 引擎从知识库目录读取自定义组件
- [ ] 组件热更新 — watch 监听组件文件变更，实时刷新渲染
- [ ] 自定义组件与内建组件统一注册，在组件面板中一起展示

### Phase 4 — 图谱与搜索

目标：知识库从"一堆文件"变成"可导航的知识网络"。

- [ ] DAG 图谱可视化 — 交互式展示文档间数据依赖关系
- [ ] 全文搜索 — 按标题 / 标签 / 内容搜索 codoc
- [ ] 反向引用 — 查看"谁引用了这个 codoc 的数据"

### Phase 5 — MCP 增强

目标：AI client 的操作能力对齐 UI。

- [ ] 搜索工具增强 — 支持按标签、data 字段值过滤
- [ ] 组件相关工具 — AI 可以查询可用组件、创建自定义组件
- [ ] 批量操作 — 重命名、移动、批量更新 data 字段
