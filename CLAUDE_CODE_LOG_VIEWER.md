# 数据流：以 Claude Code 日志场景为例

---

## 前置条件

- 用户机器上存在 `~/.claude/projects/-Users-ocean-my-project/`
- 目录下有若干 `{session-id}.jsonl` 文件
- Cobook 已启动，`@cobook/workspace` 已完成 bootstrap（source providers 已注册，graph 已初始化）
- "claude-code-log" skill 已注册到 skill registry

---

## Phase 1：接入

用户在 Cobook chat 中说："接入我的 Claude Code 项目日志"，指向目标目录。

### Step 1 — Skill 匹配

```
cobook chat engine
  → @cobook/workspace skill registry
    → 遍历已注册 skills，调用 skill.identify(source)
    → "claude-code-log" skill 命中
    → 返回 skill 实例
```

**包归属：** cobook → @cobook/workspace

### Step 2 — 目录扫描

```
@cobook/workspace lifecycle
  → 调用 @codoc/source local-directory provider
    → loader.force({ path: "~/.claude/projects/-Users-ocean-my-project/" })
    → 返回文件列表：["aaa.jsonl", "bbb.jsonl", "ccc.jsonl"]
```

**包归属：** @cobook/workspace → @codoc/source

### Step 3 — 批量创建 codoc

对目录中每个 `.jsonl` 文件：

```
@cobook/workspace lifecycle
  → 调用 skill.mapToCodec(file) 获取 codoc 配置：
      type:  skill 提供的 session log JSON Schema
      data:  { messages: { $source: { type: "local-file", path: "aaa.jsonl", parser: "jsonl" } } }
      view:  skill 提供的 MDX 模板（对话时间线组件）
  → 调用 @codoc/core 创建 codoc 实例
    → codata tree 构建：messages 节点状态为 idle（未 force）
    → literal/ref 字段立即 resolve，$source 字段挂起等待 observe
```

**包归属：** @cobook/workspace → @codoc/core

### Step 4 — 注册依赖图

```
@cobook/workspace wiring
  → 从每个 codoc 的 static meta 提取依赖声明
  → 调用 @codoc/graph.addNode() 注册节点和依赖边
  → 如果 session 之间有 continuation 关系（skill 识别），添加跨 codoc 依赖边
```

**包归属：** @cobook/workspace → @codoc/graph

### Step 5 — 启动 watch

```
@cobook/workspace watch orchestrator
  → 为目录级别注册 watcher：
      @codoc/source local-directory watcher
        → watch("~/.claude/projects/-Users-ocean-my-project/", onChange)
        → onChange 回调路由到 lifecycle（新文件 → 创建新 codoc）
  → 为每个已创建的 codoc 注册 watcher：
      @codoc/source local-file watcher
        → watch("aaa.jsonl", onChange)
        → onChange 回调路由到 graph.markDirty（内容变更 → 标脏）
```

**包归属：** @cobook/workspace → @codoc/source

**Phase 1 结束时的状态：** workspace 中有 3 个 codoc 实例，全部处于 idle（未 force）。依赖图已建立。Watch 已启动。无任何 LLM 调用、无任何文件读取（codata 惰性语义：没人 observe 就什么都不发生）。

---

## Phase 2：阅读

用户在 chat 中 reference 了 session `aaa` 的 codoc。

### Step 6 — Observe 触发

```
cobook chat engine
  → 用户 reference session-aaa codoc
  → cobook 调用 @cobook/workspace API: loadDoc("session-aaa")
    → workspace 调用 @codoc/core runtime: observe("session-aaa", "messages")
```

**包归属：** cobook → @cobook/workspace → @codoc/core

### Step 7 — Force 执行

```
@codoc/core runtime
  → 检查 messages 节点状态：idle → 需要 force
  → 查看节点声明：$source { type: "local-file", path: "aaa.jsonl", parser: "jsonl" }
  → 从 loader registry 找到 local-file loader（由 @codoc/source 提供）
  → 调用 loader.force({ path: "aaa.jsonl", parser: "jsonl" })
    → @codoc/source local-file loader 读取文件
    → @codoc/source jsonl parser 逐行解析
    → 返回结构化数据：Session 对象（metadata + messages 数组）
  → @codoc/core validation: 校验返回值是否符合 type schema
  → 节点状态：idle → forcing → resolved
  → 值缓存到 codata node
```

**包归属：** @codoc/core → @codoc/source（通过 loader registry 调用）

### Step 8 — Render

```
@codoc/core render engine
  → 取 resolved data + view MDX 模板
  → MDX 编译：view 模板 → React component
  → 将 resolved messages 数据绑定到对话时间线组件
  → 输出渲染结果
  → cobook UI 展示给用户
```

**包归属：** @codoc/core（render）→ cobook（UI）

---

## Phase 3：实时更新

Claude Code 正在运行，session `aaa.jsonl` 被追加了新的消息行。

### Step 9 — Watcher 感知变更

```
@codoc/source local-file watcher
  → fs.watch 检测到 aaa.jsonl 变更
  → 触发 onChange 回调
```

**包归属：** @codoc/source

### Step 10 — Watch 编排路由

```
@cobook/workspace watch orchestrator
  → 收到 onChange 信号
  → 识别：这是已有 codoc "session-aaa" 的 $source 目标文件
  → 路由到 graph 标脏（而非 lifecycle 创建）
  → 调用 @codoc/graph.markDirty("session-aaa.messages")
```

**包归属：** @cobook/workspace → @codoc/graph

### Step 11 — 标脏传播

```
@codoc/graph
  → markDirty("session-aaa.messages")
  → 沿 DAG 向下游传播：所有依赖 session-aaa.messages 的节点标脏
  → 返回脏节点集合
  → 通知 @codoc/core runtime：session-aaa.messages 节点状态 → dirty
```

**包归属：** @codoc/graph → @codoc/core

### Step 12 — 按需 re-force

```
如果用户仍在 observe session-aaa（即 UI 正在显示这个 codoc）：
  → @codoc/core runtime 检测到节点 dirty
  → 重新 force（同 Step 7）
  → re-render（同 Step 8）
  → 用户看到新增的消息

如果用户没有在 observe：
  → 什么都不发生。节点保持 dirty 状态。
  → 下次 observe 时才 re-force。
```

**包归属：** @codoc/core

---

## Phase 4：新 session 出现

用户启动了一个新的 Claude Code session，目录下出现了 `ddd.jsonl`。

### Step 13 — 目录 watcher 感知

```
@codoc/source local-directory watcher
  → fs.watch 检测到目录下新增文件 ddd.jsonl
  → 触发 onChange 回调
```

**包归属：** @codoc/source

### Step 14 — Watch 编排路由到 lifecycle

```
@cobook/workspace watch orchestrator
  → 收到 onChange 信号
  → 识别：这不是已有 codoc 的 source 变更，是目录级新增
  → 路由到 lifecycle（而非 graph 标脏）
```

**包归属：** @cobook/workspace

### Step 15 — 创建新 codoc

```
@cobook/workspace lifecycle
  → 重复 Step 3：调用 skill.mapToCodec("ddd.jsonl") → 创建 codoc
  → 重复 Step 4：注册到 graph
  → 重复 Step 5（部分）：为新文件注册 local-file watcher
  → 新 codoc 处于 idle 状态，等待 observe
```

**包归属：** @cobook/workspace → @codoc/core + @codoc/graph + @codoc/source

---

## Phase 5：Agent 分析

用户在 chat 中说："帮我总结 session aaa 的关键决策"。

### Step 16 — Agent 触发

```
cobook chat engine
  → 识别为 agent 任务（summary）
  → 确定目标：session-aaa codoc
  → 调用 cobook agent executor
```

**包归属：** cobook

### Step 17 — 读取 codoc 数据

```
cobook agent executor
  → 通过 @cobook/workspace API: loadDoc("session-aaa")
  → 拿到 resolved data（如果已 cached 直接返回，否则触发 force）
  → 拿到 type schema（agent 据此理解数据结构）
```

**包归属：** cobook → @cobook/workspace → @codoc/core

### Step 18 — LLM 生成

```
cobook agent executor
  → 构造 prompt：schema description + messages data + "提取关键决策"指令
  → 调用 LLM API
  → 返回结构化结果（符合 summary codoc 的 schema）
```

**包归属：** cobook

### Step 19 — Preview → Confirm → Write

```
cobook confirm flow
  → 在 chat 中展示 agent 生成的摘要预览
  → 用户审阅，确认写入
  → cobook 调用 @cobook/workspace API 创建新的 summary codoc
    → @cobook/workspace lifecycle 创建 codoc 实例
    → data 中包含 $ref 指向 session-aaa（声明依赖关系）
    → @codoc/graph 注册新节点和依赖边
  → summary codoc 进入 workspace，成为可被其他 codoc 引用的节点
```

**包归属：** cobook → @cobook/workspace → @codoc/core + @codoc/graph

---

## 包参与汇总

| Phase | @codoc/core | @codoc/graph | @codoc/source | @cobook/workspace | cobook |
|---|---|---|---|---|---|
| 1. 接入 | 创建实例 | 注册节点 | 扫描目录 + 注册 watcher | skill 匹配 + lifecycle + wiring | chat 入口 |
| 2. 阅读 | observe + force + render | — | loader 读文件 | API 转发 | reference + UI |
| 3. 实时更新 | 节点状态更新 + re-force | markDirty + propagate | watcher 感知 | 路由信号 | — |
| 4. 新 session | 创建实例 | 注册节点 | watcher 感知 + 注册新 watcher | lifecycle + 路由 | — |
| 5. Agent | force（如需） | 注册新节点 | — | API + lifecycle | agent + confirm |