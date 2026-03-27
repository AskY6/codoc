# M4 变更检测架构设计决策

## 背景

M4（跨文档引用）需要解决一个核心问题：当 B.codoc 的字段变了，依赖它的 A.codoc 怎么知道？

原 roadmap 用 chokidar 做文件监听，但这只是本地开发方案。线上化后需要不同的变更检测机制。

## 核心原则：变更感知与变更响应分离

```
变更感知（多态，环境相关）
       |
    变更事件（统一格式）
       |
变更响应（标脏 -> force -> propagate，环境无关）
```

变更响应层已经在 M0-M1 中实现：
- `DataTree.invalidateField` — 标脏（push）
- `DataTree.force` — dirty 字段 observe 时重算（pull）
- `propagateAndInvalidate` — BFS 沿 DAG 下游标脏

变更感知层是 M4+ 需要新增的。

## 三层变更源

| 层 | 描述 | 当前实现 | M4+ 需要 |
|---|---|---|---|
| intra-tree | 同文档内字段变更 | `updateField` / `invalidateField` 直接调用 | 无变化 |
| cross-doc | 其他 .codoc 的字段变了 | 不存在 | M4 新增 |
| external | $source URL / $prompt 依赖变了 | TTL 在 source loader 内部处理 | 无变化 |

## ChangeEvent 协议设计（M5 实现，M4 先用具体方案）

```typescript
interface ChangeEvent {
  // 批量，不是单个（避免多次 BFS）
  targets: FieldAddress[]
  kind: "value" | "invalidate"
  // kind=value 时可选，可做 equality check 跳过传播
  values?: Map<string, unknown>
}

interface FieldAddress {
  doc: string   // 文档标识
  path: string  // 字段 JSON Pointer
}
```

`value` vs `invalidate` 的区别：
- `value`：已知新值，可以做 equality check，值没变就不标脏下游。对应现有 `updateField`
- `invalidate`：只知道旧值不可信，需要重新 force。对应现有 `invalidateField`

## ChangeSource 接口（M5 实现）

```typescript
interface ChangeSource {
  watch(target: FieldAddress, callback: (event: ChangeEvent) => void): Disposable
}
```

可能的实现：

| 实现 | 触发方式 | 适用场景 |
|---|---|---|
| Write-through | 写入 API 直接 emit | 单进程，最简单 |
| FileWatchSource | fs.watch / chokidar | 本地开发 |
| EventBusSource | Redis pub/sub / NATS | 多容器实例 |
| DBChangeStream | MongoDB change stream / PG LISTEN-NOTIFY | 文档存 DB |
| PollSource | 定时比对版本号 | 降级兜底 |

## 决策：M4 不引入 ChangeSource 抽象

理由：
1. M4 只有一种跨文档场景（本地文件），没有多态需求
2. ChangeRouter 的路由逻辑在 M5（多存储后端）才有真实用户
3. 接口应从实现中提炼，不是先画再填

### M4 的具体做法

只做两件事：

1. **DocResolver** — 解析跨文档 `$ref`（如 `[[B.codoc]]/data/name`），定位目标文件，lazy load
2. **CrossDocDirtyPropagator** — B 变了 -> 找到所有引用 B 字段的外部文档 -> 调它们的 `invalidateField`

变更检测用 write-through：通过 API 修改文档时直接触发传播，不引入 file watcher。

### M5 再做的事

从 M4 的具体实现中提炼 `ChangeSource` / `ChangeRouter` 接口，加入：
- 多存储后端支持（DocStore 抽象）
- 批量 ChangeEvent + debounce
- 跨实例传播（pub/sub）

## 需要注意的设计陷阱

### 1. FileWatchSource 的粒度阻抗

文件监听粒度是文件，ChangeEvent 粒度是字段。中间需要：re-parse 文件 -> diff 出变更字段 -> 发出 field-level 事件。这不是简单适配器，是有状态的组件（需持有上次 parse 快照）。

### 2. 跨文档 cascade force

C 依赖 A，A 依赖 B。如果 A 没有被观察一直 dirty，C observe A 时会触发 C -> A -> B 的传递式 force 链。当前 `force` 已支持此场景（dirty 当 idle 处理），但需要关注：
- 长链的性能特征
- 中间节点 force 失败时的错误传播策略

### 3. 批量变更的 debounce

一次文件保存可能改变多个字段。应利用现有 `propagateDirty(dag, changedPaths[])` 的批量接口，一次 BFS 处理所有变更，而不是逐个触发。
