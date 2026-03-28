# Cobook 架构：Server-Driven Workspace

## 问题

Cobook 是 team knowledge graph——多人消费同一个 workspace，`$source` 发 HTTP 请求，`$prompt` 调 LLM。`observe → force → propagate` 循环天然属于 server。

当前实现把 `MultiDocRuntime` 搬到浏览器重建，导致：
- `@codoc/core` 的 `node:fs` 无法在 client bundle 中使用
- `$source` 遇 CORS，`$prompt` 暴露 API key
- 多客户端无法共享 workspace 状态
- 客户端内存中持有完整的 DataTree / DAG

核心矛盾不是打包工具问题，而是 **file-local 模式到 client/server 模式的结构性迁移**。

---

## 架构

```
┌─────────────────────────────────────────────────┐
│  Server (Next.js Route Handlers)                │
│                                                 │
│  Workspace 单例 (globalThis)                     │
│  ├── DataTree × N  (内存中的 field 状态机)        │
│  ├── DAG × N       (依赖图)                      │
│  ├── DocRegistry   (跨文档引用)                   │
│  └── SourceScheduler (TTL 定时刷新)              │
│                                                 │
│  REST ← 命令（load / update / reforce）          │
│  SSE  → 推送（field state 变更）                  │
└──────────────┬──────────────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────────────┐
│  Client (React, 薄渲染层)                        │
│                                                 │
│  WorkspaceStore (flat state: docId→field→snap)  │
│  ├── GraphView    ← 读 metadata + staleness     │
│  ├── DocView      ← 读 field values, 编译 MDX    │
│  └── ChangeFeed   ← 读 SSE 事件流               │
│                                                 │
│  不 import @codoc/core                           │
│  用户操作 → fetch(REST) → server 执行 → SSE 推回  │
└─────────────────────────────────────────────────┘
```

---

## Server API

### Workspace 单例

```typescript
// app/api/_workspace.ts
import { Workspace } from "@codoc/core";

const g = globalThis as typeof globalThis & { _ws?: Workspace };

export async function getWorkspace(): Promise<Workspace> {
  if (!g._ws) {
    g._ws = await Workspace.create(resolve(process.cwd(), "docs"));
  }
  return g._ws;
}
```

Next.js dev 模式下 HMR 会重建模块，`globalThis` 保证单例存活。Production 同理（单进程部署场景）。

### REST 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/workspace` | GET | `listDocs()` + `getDependencyGraph()` |
| `/api/docs/[docId]` | GET | 加载文档：field states + raw view template |
| `/api/docs/[docId]/force` | POST | `forceAll()` 该文档 |
| `/api/docs/[docId]/field` | POST | 更新或 re-force 指定字段 |
| `/api/events` | GET | SSE 流 |

#### GET /api/workspace

返回值：不触发任何 force，只读 meta。

```typescript
interface WorkspaceSnapshot {
  docs: DocMeta[];                           // listDocs()
  graph: { nodes: FieldAddress[]; edges: DepEdge[] };  // getDependencyGraph()
}
```

#### GET /api/docs/[docId]

调用 `workspace.loadDoc(docId)`，返回当前 field 快照 + view 模板。如果文档首次加载，server 触发 `forceAll()` 并通过 SSE 推增量。

```typescript
interface DocSnapshot {
  docId: string;
  fields: Record<string, FieldSnapshot>;     // 当前各字段状态
  view: string;                              // 原始 MDX 模板（含 {fieldName}）
  externalRefs: ExternalDep[];               // 跨文档依赖
}

interface FieldSnapshot {
  status: "idle" | "pending" | "resolved" | "error" | "dirty";
  value?: unknown;                           // resolved 时有值
  error?: string;                            // error 时有消息
  loaderType: string;
}
```

#### POST /api/docs/[docId]/field

```typescript
interface FieldAction {
  path: string;                              // e.g. "/name"
  action: "update" | "reforce";
  value?: unknown;                           // action=update 时提供
}
```

Server 执行 `tree.updateField()` 或 `tree.refreshField() + tree.observe()`，脏传播沿 DAG + 跨文档进行。所有变更通过 SSE 推送。

### SSE /api/events

Server 订阅 `workspace.onFieldChange()`，将每次 field state transition 序列化为 SSE event。

```typescript
// event: field
// data: {"docId":"product.codoc","path":"/stock","status":"resolved","value":{...},"ts":1711612345000}

// event: field
// data: {"docId":"order.codoc","path":"/productName","status":"dirty","ts":1711612345100}
```

client 用 `EventSource` 接收，更新本地 store。

---

## Client

### 核心原则

- **不 import `@codoc/core`**。所有 core 逻辑在 server 执行。
- **状态来源唯一**：REST 拉初始快照，SSE 推增量。
- **渲染层复用**：MDX view 在 client 编译，`<CodataValue>` 从 store 读值。

### WorkspaceStore

client 唯一的状态容器。简单的 `Map` + subscriber 模式，不引入额外框架。

```typescript
interface WorkspaceStore {
  // 读
  getDocs(): DocMeta[];
  getGraph(): { nodes: FieldAddress[]; edges: DepEdge[] };
  getFieldSnapshot(docId: string, path: string): FieldSnapshot | undefined;
  getDocFields(docId: string): Record<string, FieldSnapshot> | undefined;

  // 写（仅由 SSE handler 调用）
  applyFieldEvent(event: FieldEvent): void;

  // 订阅
  subscribe(listener: () => void): () => void;
  subscribeField(docId: string, path: string, listener: () => void): () => void;
}
```

React 组件通过 `useSyncExternalStore` 绑定到 store 的特定 field。

### CodataValue（client 版）

不再需要 DataTree。直接从 store 读：

```tsx
function CodataValueInner({ path }: { path: string }) {
  const docId = useCurrentDocId();              // 从 DocView context 拿
  const snap = useFieldSnapshot(docId, path);   // 从 store 读

  if (!snap || snap.status === "idle" || snap.status === "pending")
    return <span className="text-muted-foreground">...</span>;
  if (snap.status === "error")
    return <span className="text-red-500">{snap.error}</span>;
  if (snap.status === "dirty")
    // 显示旧值 + staleness 标记
    return <span className="opacity-60">{format(snap.value)}</span>;

  return <>{format(snap.value)}</>;
}
```

Dirty 状态不再需要 overlay 层——`CodataValue` 本身就能表达 staleness。

### 三个视图

**GraphView**
- 初始数据：`GET /api/workspace` → docs + graph
- 实时更新：SSE `field` 事件 → 节点状态色变
- 交互：点击节点 → `setSelectedDocId()`

**DocView**
- 打开时：`GET /api/docs/[docId]` → field 快照 + view 模板
- client 编译 MDX：`evaluate(preprocess(view))` → React 组件
- `CodataValue` 从 store 读值，SSE 推送自动更新
- Re-force：`POST /api/docs/[docId]/field` → server 执行 → SSE 推回
- 依赖面板：从 `externalRefs` 渲染，点击跳转

**ChangeFeed**
- 纯 SSE 消费：收到 event 追加到本地 list
- 每条 entry：docId + fieldPath + status + timestamp
- 点击 → 跳转到对应 doc

---

## 与 M5-core Workspace 的关系

当前 `Workspace` 类的四个 API 全部由 server 消费：

| Workspace API | Server 使用方式 |
|---|---|
| `listDocs()` | `GET /api/workspace` 序列化返回 |
| `getDependencyGraph()` | `GET /api/workspace` 序列化返回 |
| `loadDoc(docId)` | `GET /api/docs/[docId]` 内部调用，返回 field 快照 |
| `onFieldChange(cb)` | SSE handler 注册回调，序列化推送 |

Client 不直接接触 Workspace。Cobook server 层是 Workspace API 到 HTTP API 的投射。

---

## 实现步骤

### 1. Server 层

```
app/api/
├── _workspace.ts          Workspace 单例管理
├── workspace/route.ts     GET → listDocs + graph
├── docs/[docId]/route.ts  GET → loadDoc + field snapshots
│                          POST → forceAll
├── docs/[docId]/field/route.ts  POST → update / reforce
└── events/route.ts        GET → SSE stream
```

每个 route handler 约 30-50 行，薄薄一层序列化。

### 2. Client 层

```
src/
├── lib/
│   ├── workspace-store.ts     WorkspaceStore (Map + subscribers)
│   └── api.ts                 fetch helpers (typed)
├── hooks/
│   ├── use-workspace.ts       SSE 连接 + store hydration
│   ├── use-field-snapshot.ts  useSyncExternalStore 绑定
│   └── use-current-doc.ts     DocView context
├── components/
│   ├── WorkspaceShell.tsx     初始化 store + SSE + 布局
│   ├── GraphView.tsx          图谱（SVG, zoom/pan）
│   ├── DocView.tsx            文档渲染（MDX + staleness）
│   ├── ChangeFeed.tsx         变更流（SSE 事件列表）
│   ├── CodataValue.tsx        field 值展示（从 store 读）
│   └── mdx-components.tsx     MDX 组件注册表
└── app/
    ├── page.tsx               Server Component → 传初始 props
    └── layout.tsx
```

### 3. 顺序

1. `_workspace.ts` + `GET /api/workspace` — 验证 Workspace 单例可用
2. `GET /api/events` SSE — 验证 field 变更推送
3. `workspace-store.ts` + `use-workspace.ts` — client 状态层
4. `GraphView` — 读 store 渲染图谱
5. `GET /api/docs/[docId]` + `DocView` — 文档加载与 MDX 渲染
6. `POST field` + `ChangeFeed` — 交互闭环

---

## 不在 MVP 做的事

- WebSocket（SSE 够用，单向推送足够）
- 多 workspace 切换（MVP 只有一个 docs/ 目录）
- 认证与权限
- Server 端 MDX 编译（client 编译延迟可接受）
- Workspace 持久化（进程内单例，重启重建）
