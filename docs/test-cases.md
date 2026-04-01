# Cobook 用户视角 Test Cases

## 1. Workspace 管理

### W-1 初始化工作区

- **操作**: `cobook init my-project`
- **预期**: 生成 `cobook.yaml`、`.codoc/` 目录，数据库中创建 workspace 记录

### W-2 打开已有工作区

- **操作**: `cobook open .` 或 Web 打开项目
- **预期**: 加载 `cobook.yaml`，扫描所有 `.codoc` 文件，构建 DAG

### W-3 查看工作区概览

- **操作**: `cobook status` 或 Web 首页
- **预期**: 列出 codoc 数量、节点状态分布（ready/dirty/error）、最近变更

### W-4 打开不存在的工作区

- **操作**: `cobook open /nonexistent`
- **预期**: 明确报错：找不到 `cobook.yaml`

---

## 2. Codoc CRUD

### C-1 创建静态数据 codoc

- **操作**: 创建 `.codoc` 文件，data 字段为 `static` 类型
- **预期**: 解析成功，节点状态 → ready，数据库持久化

### C-2 创建文件源 codoc

- **操作**: data 声明 `$source: file`，指向本地 `.csv`
- **预期**: resolve 时读取文件内容，节点状态 → ready

### C-3 创建引用型 codoc

- **操作**: data 中使用 `$ref: ./other.codoc#data.field`
- **预期**: 建图时产生依赖边，resolve 时获得被引用字段的值

### C-4 查看单个 codoc

- **操作**: `cobook show notes/meeting.codoc` 或 Web 点击
- **预期**: 展示 meta、data resolved 值、view 渲染结果

### C-5 更新 codoc 内容

- **操作**: 编辑 `.codoc` 文件中的 data 字段
- **预期**: 触发增量重建：自身 dirty → rebuild → 下游失效传播

### C-6 删除 codoc

- **操作**: 删除 `.codoc` 文件
- **预期**: 图中节点移除，依赖它的下游 codoc 状态 → error（断引用）

### C-7 创建空 codoc

- **操作**: 只有 meta，无 data 无 view
- **预期**: 合法，节点状态 idle，不参与求值

### C-8 codoc 含非法格式

- **操作**: 写入语法错误的 `.codoc`
- **预期**: 解析阶段报错，节点状态 → error，不影响其他节点

---

## 3. 引用与依赖图

### R-1 查看依赖图

- **操作**: `cobook graph` 或 Web 图谱页面
- **预期**: 可视化展示所有 codoc 及其字段级依赖关系

### R-2 查看单节点上下游

- **操作**: `cobook graph notes/meeting.codoc`
- **预期**: 列出该 codoc 的上游依赖和下游消费者

### R-3 循环依赖检测

- **操作**: A ref → B，B ref → A
- **预期**: build 阶段报错：检测到循环依赖，明确指出环路路径

### R-4 断引用检测

- **操作**: codoc 引用了一个不存在的路径
- **预期**: build 阶段报错：`$ref` 目标不存在

### R-5 跨字段引用

- **操作**: A 的 `data.summary` 引用 B 的 `data.content`
- **预期**: 字段级 DAG 正确建立，resolve 粒度到字段

---

## 4. Build 与 Resolve

### B-1 全量 build

- **操作**: `cobook build`
- **预期**: 扫描所有 codoc → 解析 → 校验 schema → 建图 → 报告结果

### B-2 增量 resolve

- **操作**: 修改某个上游 codoc 的数据
- **预期**: 仅该节点及下游失效，重新 resolve，其余不动

### B-3 结构变化 vs 值变化

- **操作**: 给 codoc 新增一个 data 字段 vs 只改值
- **预期**: 新增字段 → rebuild 图结构；改值 → 仅 resolve 传播

### B-4 并发 resolve

- **操作**: 同时请求多个无依赖关系节点的值
- **预期**: 并行求值，互不阻塞

### B-5 节点状态流转

- **操作**: 观察 file source codoc 从创建到 resolve
- **预期**: idle → computing → ready（成功）或 error（失败）

### B-6 上游 error 传播

- **操作**: A 依赖 B，B 状态为 error
- **预期**: A 不会尝试 resolve，状态保持 dirty 或 error，给出明确原因

---

## 5. AI / Chat 交互

### A-1 启动对话

- **操作**: CLI 或 Web 打开 chat
- **预期**: 创建 chat session，base-agent 加载 workspace 概览

### A-2 询问工作区状态

- **操作**: "当前项目有哪些 codoc？"
- **预期**: agent 通过 service 查询，返回 codoc 列表和状态

### A-3 让 AI 读取 codoc

- **操作**: "帮我看看 notes/meeting.codoc 的内容"
- **预期**: agent 通过 service 读取并解读

### A-4 让 AI 创建 codoc

- **操作**: "把我们讨论的结论整理成一个新的 codoc"
- **预期**: agent 通过 service 创建 codoc → 触发 build → 用户可查看

### A-5 让 AI 更新 codoc

- **操作**: "把 summary 字段更新为..."
- **预期**: agent 通过 service 更新 → 触发增量 rebuild

### A-6 让 AI 查询依赖

- **操作**: "这个 codoc 被哪些其他 codoc 引用了？"
- **预期**: agent 查询图，返回下游消费者列表

### A-7 AI 上下文可控

- **操作**: 对话中 pin 特定 codoc
- **预期**: agent 只基于 pinned codoc 和 workspace 概览回答，不会超出范围

### A-8 AI 不绕过 service

- **操作**: AI 尝试直接写文件
- **预期**: 被 service 边界拦截，所有写操作必须经过 service

### A-9 流式输出

- **操作**: AI 生成较长回答
- **预期**: CLI/Web 均能流式展示

### A-10 对话历史持久化

- **操作**: 关闭后重新打开 chat
- **预期**: 历史消息从 PostgreSQL 恢复

---

## 6. Source 执行

### S-1 static 求值

- **操作**: codoc data 为内联静态值
- **预期**: 直接返回值，无外部 IO

### S-2 file 求值

- **操作**: codoc data 引用本地文件
- **预期**: 读取文件内容作为值

### S-3 codoc 引用求值

- **操作**: codoc data 引用另一个 codoc 的字段
- **预期**: 按 DAG 拓扑序 resolve 上游后返回

### S-4 file 不存在

- **操作**: 引用的文件路径不存在
- **预期**: 节点状态 → error，错误信息明确

### S-5 file 内容变化

- **操作**: 被引用文件内容更新
- **预期**: 检测到值变化 → 触发该节点及下游 re-resolve

---

## 7. 错误与边界

### E-1 Schema 校验失败

- **操作**: codoc data 不符合 meta 中声明的 schema
- **预期**: build 阶段报错，指出哪个字段违反了什么约束

### E-2 大量 codoc 性能

- **操作**: workspace 含 500+ codoc
- **预期**: build 和 graph 操作在合理时间内完成

### E-3 同时 CLI + Web 访问

- **操作**: CLI 修改 codoc 同时 Web 在查看
- **预期**: 数据一致，Web 能感知到变更
