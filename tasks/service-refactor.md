# Service 层重构任务清单

目标：消除 `packages/service/` 里逻辑模型与物理存储的耦合，让服务层成为真正的唯一边界。

任务按"先封边界 → 再拆数据 → 再拆职责 → 再抽内容"分四个阶段。每个任务给出改动点、验收标准、依赖。

---

## 阶段 0：基线保障（前置，无业务改动）

### T0.1 补齐服务层契约的集成测试
- **改动点**：`packages/service/__tests__/` 下补齐 `build()` / `resolveNode()` / `patchCodocData()` / `applyPreset()` 的端到端用例，覆盖：
  - 正常 build + resolve → 读出 `resolvedValue`
  - 修改 content 后 build 的 `dirty → ready` 流转
  - 循环依赖、broken ref 时 `nodeState` 的落地
  - preset 应用后的 `workspace_agents` 落库
- **验收**：新测试在当前 main 分支全部通过（作为黄金基线，后续重构跑回归）。
- **依赖**：无。

---

## 阶段 1：封死服务层边界

### T1.1 把 `packages/service` 拆成 `storage` + `service` 两个包
- **改动点**：
  - 新增 `packages/storage/`，把 `src/db/**`（`client.ts / schema.ts / migrate.ts / seed.ts / repositories/**`）整包迁移过去。
  - `packages/service/` 只保留 `workspace-service.ts / chat-service.ts / source-executor.ts / presets/ / types.ts`。
  - `@cobook/service` 从 `@cobook/storage` import 仓储接口和工厂，**不再 re-export** `createXxxRepository / createDb`。
  - 更新根 `pnpm-workspace.yaml`、`tsconfig` 路径、`drizzle.config.ts` 归属到 storage。
- **验收**：
  - `apps/server/src/index.ts` 里 `createDb / createXxxRepository` 的 import 来自 `@cobook/storage`；`createWorkspaceService / createChatService` 来自 `@cobook/service`。
  - `packages/service` 的 `package.json` dependencies 里出现 `@cobook/storage`。
  - `pnpm --filter @cobook/service build` 通过。
- **依赖**：T0.1。

### T1.2 禁止 HTTP 路由直接依赖仓储
- **改动点**：
  - `apps/server/src/routes/graph-routes.ts` 改为依赖 `WorkspaceService.getGraph(workspaceId)`，新增这个方法返回 `{ nodes, edges }`。
  - `apps/server/src/routes/workspace-routes.ts` / `codoc-routes.ts` 同样改为只接收 service，不再接收 repo。
  - `apps/server/src/index.ts:80-83` 的路由组装只传 service 实例。
- **验收**：在 `apps/server/src/routes/**` 下全局 grep `Repository`，除了类型注释外零引用；在 `apps/server/**` grep `@cobook/storage` 应为零。
- **依赖**：T1.1。

### T1.3 在 service 工厂里接管 `Database` 句柄，暴露事务 API
- **改动点**：
  - `createWorkspaceService` 改为接收 `{ db, workspaceRepo, codocRepo, edgeRepo, chatRepo }`，其中 `db: Database` 为新增依赖。
  - 仓储工厂改为接收 `dbOrTx: Database | Transaction`（Drizzle 的 `PgTransaction`），同一份仓储代码在 tx 和 root db 下都能跑。
  - 服务层暴露内部 helper `withTx(fn)`，`build()` / `resolveNode()` / `createCodocEntry()` / `updateCodocEntry()` / `deleteCodocEntry()` 的写路径全部包进单一事务。
- **验收**：
  - 新增测试："build 中途抛错 → 数据库回到 build 之前的状态"。
  - `db.transaction(...)` 在 `workspace-service.ts` 里被调用至少一次。
- **依赖**：T1.1。

---

## 阶段 2：拆掉 `codocs` 表的真相源/缓存混存

### T2.1 定下 codoc 的真相源：只保留 `content`
- **决策**：以 `content`（YAML 原文）作为唯一真相源，`ast` 列删除。
- **改动点**：
  - 新 drizzle migration：`ALTER TABLE codocs DROP COLUMN ast;`
  - `codoc-repository.ts` 去掉 `ast` 字段读写。
  - `workspace-service.ts.build()` 不再读 `row.ast`，总是 `parseCodoc(row.content)`；解析结果只留在本次调用的内存 map。
  - `getCodocEntry` 返回值里不再包含 `ast`，由调用方按需解析（或由 service 显式提供 `getParsedCodoc`）。
- **验收**：`packages/storage/src/db/schema.ts` 里 `codocs` 无 `ast` 列；`workspace-service.ts` 无任何 `row.ast` 引用。
- **依赖**：T1.3。

### T2.2 把 `resolvedValue` 拆到独立表 `codoc_resolved_fields`
- **新表**：
  ```
  codoc_resolved_fields(
    id, workspace_id, codoc_id, node_id text not null,
    value jsonb, state text not null,    -- 'ready' | 'error'
    built_at timestamptz,
    unique(workspace_id, node_id)
  )
  ```
- **改动点**：
  - 新增 `ResolvedFieldRepository` 接口：`replaceForCodoc(codocId, fields[])`、`listByCodoc(codocId)`、`listByWorkspace(workspaceId)`、`findByNodeId(workspaceId, nodeId)`。
  - `workspace-service.ts.build()`：删除所有"读旧 resolved → merge → validKeys 清洗 → 写回"的胶水代码（第 244-263 行附近 & 第 340-357 行）。改成：每轮 build 后，对每个 codoc 调用 `resolvedFieldRepo.replaceForCodoc(codocId, newFields)`，由 unique 索引天然淘汰陈旧 node_id。
  - `codocs` 表 drop `resolved_value` 列。
  - `CodocInfo.resolvedData` 变成 `Record<nodeId, value>`，由 service 从 `codoc_resolved_fields` 聚合。
- **验收**：
  - `build()` 中 `validKeys` / `cleaned` 这段代码消失。
  - 测试："删除 codoc 中某个字段 → build 后 `codoc_resolved_fields` 里该 node_id 不再存在"。
- **依赖**：T2.1。

### T2.3 把 `nodeState` 移到字段粒度
- **改动点**：
  - `codocs.nodeState` 列删除。
  - codoc 的"整体状态"改为 service 层从 `codoc_resolved_fields` 聚合派生（`'error' if any field state=error else 'ready' if all ready else 'dirty'`）。
  - `WorkspaceStatus` 统计逻辑改用聚合查询。
- **验收**：DAG 报错时，错误能精确定位到 `nodeId`，而不是整篇 codoc。新增测试校验。
- **依赖**：T2.2。

### T2.4 决定 `edges` 表的角色：物化视图，不参与执行
- **决策**：`edges` 表不做引擎数据源，只作为可视化物化视图。
- **改动点**：
  - 在 `WorkspaceService.getGraph(workspaceId)` 里直接从 `edges + codocs` 读取（已在 T1.2 引入该方法）。
  - `resolveNode` 永远不读 `edges`；当 `dagCache` miss 时就现场 `build()`。
  - 在 schema 注释里明确 "physical materialized view, do not use for execution"。
- **验收**：`resolveNode()` 源码里无 `edgeRepo` 引用；`graph-routes` 通过 service 拿图。
- **依赖**：T1.2。

### T2.5 `patchCodocData` 语义重写
- **改动点**：
  - 由于 T2.1 已确认 `content` 是真相源，`patchCodocData` 合法化为"解析 → 改 → 重写 YAML → 调 `updateCodoc`"，但要：
    - 把"修改 raw 对象再 stringify"的那套逻辑抽到 `@cobook/core` 里的纯函数 `patchCodocSource(content, dataPath, value): string`；service 只编排。
    - 禁止直接访问 `row.ast`（T2.1 已经删列，这步是收尾）。
- **验收**：`workspace-service.ts` 里 `patchCodocDataEntry` 小于 20 行。纯函数 `patchCodocSource` 在 `@cobook/core` 下有独立单测。
- **依赖**：T2.1。

---

## 阶段 3：服务内部职责拆分

### T3.1 拆分 `workspace-service.ts`
- **新模块**（都在 `packages/service/src/` 下）：
  - `workspace-service.ts`：仅 `createWorkspace / updateWorkspace / getStatus / listWorkspaces`。
  - `codoc-service.ts`：`listCodocs / getCodoc / createCodoc / updateCodoc / deleteCodoc / patchCodocData`。
  - `build-service.ts`：`build / resolveNode / getGraph`，内部持有 `dagCache`（见 T3.3 处理）。
  - `preset-service.ts`：`listPresets / applyPreset / createWorkspaceFromPreset`。
- **改动点**：
  - 公共导出在 `index.ts` 组合这四个 service，对外 API 形状尽量保持兼容（或让 `apps/server` 同步改）。
  - 每个 service 的依赖只包含它真正用到的仓储。
- **验收**：`workspace-service.ts` 不再超过 120 行；`apps/server` 里按需注入四个 service。
- **依赖**：T2.2、T2.3、T2.4。

### T3.2 把 `workspace_agents` 从 `chatRepository` 搬出去
- **改动点**：
  - 新增 `WorkspaceAgentRepository`（`setForWorkspace / listByWorkspace`），由 `preset-service` 和 `workspace-service` 直接依赖。
  - `chat-repository.ts` 只保留真正 chat 相关的方法（threads、messages、thread_codocs、thread_agents）。
  - `applyPreset` 不再把 `chatRepo` 作为可选依赖，改为直接依赖 `workspaceAgentRepo`。
- **验收**：`workspace-service` / `preset-service` 没有对 `chatRepo` 的引用；`applyPreset` 签名不再带 `chatRepo?`。
- **依赖**：T3.1。

### T3.3 把 `dagCache` 和 source registry 显式化
- **改动点**：
  - `dagCache` 从闭包 `Map` 提升为 `BuildService` 的成员字段，且用 `{ build, resolveNode, invalidate }` 显式 API；在 `createCodoc / updateCodoc / deleteCodoc / applyPreset` 完成后显式调 `buildService.invalidate(workspaceId)`。
  - 在构造 `BuildService` 时接受一个可注入的 cache 接口（默认实现是进程内 Map），为后续换成 Redis 留口。
  - `source-executor.ts` 的模块级 `serverRegistry` 改为 `createSourceRegistry()` 工厂，由 `apps/server/src/index.ts` 构造并注入给 `BuildService`；模块级全局删除。
- **验收**：`packages/service/src/**` 全局 grep `let .* = new Map`、`const .* = new Map()` 在模块作用域下为零。
- **依赖**：T3.1。

---

## 阶段 4：内容与代码解耦

### T4.1 presets 内容外移
- **决策**：把 preset 定义变成 JSON 数据或独立包 `@cobook/presets`。
- **改动点**：
  - 新建 `packages/presets/` 或在 `packages/service/presets/data/*.json`：每个 preset 一份 JSON，包含 codoc 源码、agent 选项、meta。
  - `preset-service` 在启动时加载这些 JSON（通过 package import，**不走文件系统**，保持硬规则 2），校验 schema（zod）后注册。
  - 删除 `ai-dev-radar.ts` 里硬编码内容。
- **验收**：新增 preset 只需动 JSON 文件，无 TS 代码改动；`preset-service` 有 schema 校验测试。
- **依赖**：T3.1。

### T4.2 领域类型与行类型彻底分离
- **改动点**：
  - 在 `packages/service/src/domain/` 定义 `CodocDocument`、`NodeState = "idle"|"dirty"|"ready"|"error"`、`ResolvedField`、`WorkspaceSummary` 等领域模型。
  - 仓储接口 `find*` / `list*` 的返回类型仍是 row，但 service 在边界处映射为 domain 类型。
  - service 对外只暴露 domain 类型，`apps/server` 的路由直接 `c.json(domainObject)`。
- **验收**：`apps/server/src/routes/**` 没有出现 `row.ast`、`as CodocAST` 之类的裸强转。
- **依赖**：T2.3、T3.1。

---

## 依赖关系速览

```
T0.1 ──┐
       ├─► T1.1 ─► T1.2 ─┐
       │         └─► T1.3 ┐
       │                  ├─► T2.1 ─► T2.2 ─► T2.3 ─┐
       │                  │           └─► T2.5      │
       │                  └─► T2.4 ─────────────────┤
       │                                             ▼
       │                                         T3.1 ─┬─► T3.2
       │                                                ├─► T3.3
       │                                                ├─► T4.1
       │                                                └─► T4.2
```

## 非目标（本轮不做）
- 不改 DAG 引擎本身的算法。
- 不引入 Redis / 外部缓存（只为未来留接口）。
- 不做多进程部署，也不做跨服务事务。
- 不动 CLI / Web 的界面层代码，只在 API 形状变更时同步类型。
