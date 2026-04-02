# Fix: 移除文件系统作为数据源

## 核心问题

当前实现将 `.codoc` 视为本地文件，service 层在 CRUD 时读写文件系统。这与 Server-centric 架构矛盾：**codoc 是数据库记录，不是本地文件。**

用户本地只有 `cobook.yaml`（标记目录与 server workspace 的关联），所有 codoc 数据存储在 PostgreSQL。

---

## 需要修改的文件

### 1. `packages/service/src/workspace-service.ts`

**openWorkspace(dir)**
- 移除：`scanCodocFiles(dir)` 扫描本地 `.codoc` 文件
- 移除：读取文件内容并 `codocRepo.upsert`
- 保留：读取 `cobook.yaml` 获取 workspace name
- 保留：在 DB 中创建/查找 workspace 记录

**createCodoc(workspaceId, path, content)**
- 移除：`writeFile(absPath, content)` 写入本地文件
- 保留：解析 content → upsert DB → 触发 build

**updateCodoc(workspaceId, path, newContent)**
- 移除：`writeFile(absPath, newContent)` 写入本地文件
- 保留：解析 → upsert DB → rebuild

**deleteCodoc(workspaceId, path)**
- 移除：`unlink(absPath)` 删除本地文件
- 保留：`codocRepo.delete` → rebuild

**resolve(workspaceId, nodeId)**
- 移除：对 `ws.rootPath` 的依赖（file source executor 需要重新设计）

**辅助函数**
- 移除：`scanCodocFiles()` 整个函数
- 移除：`toSource()` 中的 `type: "file"` 分支（或重新定义 file source 的含义）

### 2. `packages/service/src/source-executor.ts`

**`executeSource({ type: "file", path })`**
- 当前：从本地文件系统读取文件内容
- 问题：没有本地文件了，`type: "file"` source 的语义需要重新定义
- 方案：
  - 选项 A：移除 file source，所有数据都是 static 或 ref
  - 选项 B：file source 改为从外部 URL 获取（http/https）
  - 选项 C：file source 改为引用 DB 中其他资源（如附件表）

### 3. `packages/service/src/workspace-service.ts` — import 清理

移除不再需要的 import：
```typescript
// 删除这些
import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
```

保留：
```typescript
import { readFile } from "node:fs/promises";  // 仅用于读取 cobook.yaml
import { resolve } from "node:path";           // 仅用于解析 cobook.yaml 路径
```

### 4. `apps/cli/src/commands/init.ts`

- 保留：在本地创建 `cobook.yaml`
- 保留：调 Server API 注册 workspace
- 确认：`cobook.yaml` 只记录关联信息（workspace name），不涉及 codoc

### 5. `apps/cli/src/workspace-discovery.ts`

- 保留：CWD 向上查找 `cobook.yaml` 的逻辑（这是 CLI 发现 workspace 的方式）
- 注意：`cobook.yaml` 的 `rootPath` 概念可能需要弱化为一个标识符

### 6. 数据库 schema — 可选调整

`packages/service/src/db/schema.ts` 中 `workspaces` 表：
- `rootPath` 字段：保留还是移除？
  - 如果保留：仅作为 CLI 发现机制的反向索引（rootPath → workspaceId）
  - 如果移除：CLI 需要其他方式关联本地目录与 workspace

建议保留 `rootPath`，但语义从"codoc 文件所在目录"变为"CLI 关联目录标识"。

---

## 不需要修改的文件

- `packages/core/*` — 纯计算层，不涉及文件系统
- `packages/service/src/db/repositories/*` — DB 操作层，已经正确
- `packages/service/src/chat-service.ts` — 不涉及文件系统
- `packages/agent/*` — 通过 service API 操作，不直接碰文件
- `apps/server/src/routes/*` — HTTP 路由层，透传 service 调用
- `apps/cli/src/commands/chat.ts` — 通过 API client 操作

---

## 修改后的数据流

```
之前（错误）:
  createCodoc → writeFile(本地) + upsert(DB)
  openWorkspace → scanCodocFiles(本地) → upsert(DB)

之后（正确）:
  createCodoc → parse(content) → upsert(DB) → build(DB)
  openWorkspace → create workspace record(DB)
```

---

## 验收标准

1. `pnpm turbo typecheck` 零错误
2. `pnpm turbo test` 全通过
3. `cobook init` 只创建 `cobook.yaml`，注册 workspace 到 DB
4. 通过 `cobook chat` 让 agent 创建 codoc → 数据只写入 DB，本地无 `.codoc` 文件
5. `cobook show <path>` 从 DB 读取并展示
6. `cobook build` 从 DB 读取所有 codoc，构建 DAG，结果写回 DB
