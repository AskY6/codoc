# observe/subscribe 原语拆分计划

## 背景：断裂点

`order.codoc` 通过 `$ref: "[[user.codoc]]/recentActivity"` 引用了 `user.codoc` 的 `$source` 字段。当 TTL 过期后，没有任何机制触发重取，因为：

1. `DataTree.force()` 在 `status === "resolved"` 时直接返回缓存值，永远不会再调 loader
2. `sourceLoader` 的 TTL 缓存只在被调用时才检查过期，但 force 短路导致它根本不被调用
3. 整个系统没有定时器主动 invalidate 过期节点

根本原因：**缺少一个统一的标脏触发者**，以及将标脏信号传递给消费者的一等原语。

## 核心设计

将 observe 拆为两个原语：

- **`observe(node) -> value`**：单次求值，force 依赖链，返回当前值。已有，不变。
- **`subscribe(node, callback) -> unsubscribe`**：持续监听，节点被标脏时触发 callback。

关键约束：**subscribe 不自动 re-force**。它只传递"值可能过期了"的信号，消费者自行决定是否 re-observe。这避免了不必要的瀑布式 force（下游组件可能不在视口、tab 已切走等）。

## 现有代码盘点

已经有的（只需 formalize，不需重写）：

| 组件 | 文件 | 现状 |
|---|---|---|
| `subscribeField(path, cb)` | `data-tree.ts:170` | 存在，但只是实现细节 |
| `notify(path)` | `data-tree.ts:183` | 存在，field listener + global listener |
| `invalidateField(path)` | `data-tree.ts:220` | resolved/error -> dirty，调 notify |
| cross-doc subscription | `doc-registry.ts:81` | `addConsumer` 内部用 `subscribeField` |
| React 消费 | `codata-react.tsx:80` | `useSyncExternalStore` + `subscribeField` |

缺少的：

| 缺失 | 影响 |
|---|---|
| 标脏传播不触发 subscribe | `propagateAndInvalidate` 标脏下游节点时，没有触发那些节点的 subscription callback |
| 无 TTL 主动 invalidation | `$source` TTL 过期后无人调 `invalidateField` |
| subscribe 未作为一等原语暴露 | 语义散落在实现中，无统一协议 |

## 分里程碑改动

### M1：内核补 subscribe 原语

**改动范围**：`packages/core/src/`

1. **dirty-propagator.ts** — `propagateAndInvalidate` 标脏一个节点后，调用该节点的 `notify`（当前只改状态不通知）

   验证：标脏 A，A 的下游 B 有 subscription，B 的 callback 被触发

2. **data-tree.ts** — 将 `subscribeField` / `subscribe` 提升为一等公民，补充文档注释明确协议：
   - callback 触发时机：字段被标脏（dirty）
   - callback 不 auto-force
   - 返回 unsubscribe 函数

3. **测试** — 新增 `subscribe-propagation.test.ts`：
   - 单节点 subscribe + invalidate -> callback 触发（已有类似，确认覆盖）
   - 脏传播链中下游节点的 subscribe callback 触发（新增）
   - unsubscribe 后不再触发（新增）

**不改的**：observe 语义、force 逻辑、DAG 结构、现有测试。

### M2：Render engine 接入 subscribe

**改动范围**：`apps/web/src/runtime/`

当前 `codata-react.tsx` 的 `useCodata` 已经是 subscribe-based reactive loop：

```
subscribeField -> useSyncExternalStore -> dirty 时 re-render -> useCodata 见 dirty -> re-observe
```

M1 改动后，dirty propagation 会触发 notify，React 自然收到通知。**M2 可能不需要改代码**，只需验证：

- 上游字段变更 -> 下游字段被标脏 -> React 组件 re-render -> 显示新值
- Suspense 边界在 re-observe 期间正确显示 loading 状态

### M3：$source 增加 refresh 策略

**改动范围**：`packages/core/src/loader/source.ts`、`packages/core/src/scheduler.ts`

在 `$source` 声明中增加 refresh 策略：

```yaml
recentActivity:
  $source: "https://..."
  ttl: 30
  refresh: eager   # 或 lazy
```

两种策略：

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `eager` | scheduler 到期主动 fetch，值变了则写入 + 标脏传播 | 数据实时性要求高，如仪表盘 |
| `lazy` | scheduler 到期只 `invalidateField`（标脏），实际 fetch 延迟到下次 observe | 节省带宽，如后台 tab |

实现要点：

1. **SourceScheduler**（新增）— 管理所有 `$source` 字段的 TTL 定时器
   - `register(field)` — 根据 ttl 注册 `setTimeout`/`setInterval`
   - `eager`：到期 -> evict cache -> refreshField -> observe -> 值变了? -> 标脏传播
   - `lazy`：到期 -> invalidateField -> subscribe 链路自动通知消费者
   - `dispose()` — 清理所有定时器

2. **CodocRuntime** — 构造时扫描所有 `$source` 字段，注册到 SourceScheduler

3. **两种策略都通过标脏传播进入已有的 subscribe 通知链路**，不需要新机制

默认策略：`lazy`（保守，不浪费带宽）。

### M5：跨文档 proxy 节点的 subscription 生命周期

**改动范围**：`packages/core/src/cross-doc-propagator.ts`、`packages/core/src/doc-registry.ts`

纳入"文档加载与生命周期管理"的设计范围：

- **建立时机**：`wireExternalDeps` 时注册 subscription（已有）
- **销毁时机**：文档 unload 时 `unregister` 清理 subscription（已有基础，`doc-registry.ts:32-48`）
- **外部文档重载后的恢复**：目标文档被替换时，旧 subscription 失效，需重新 wire

具体设计延后到 M5 阶段，此处只标记需求。

## 不需要改的部分

- 核心等式：`observe(codata) -> force(deps) -> value -> propagate(dependents)`
- Codata loader 分类（literal / ref / source / prompt / external）
- DAG 构建与 cycle detection
- M4 Agui — render engine 的一部分，自然继承 subscribe 语义
- 断裂点策略（双层依赖图、三态节点、proxy 节点、写入约束）
- `.codoc` 文件格式（type / data / view 三段结构）

## 实施顺序

```
M1 subscribe 原语（~半天）
  |
  v
M2 验证 React 链路（~1h，可能零改动）
  |
  v
M3 SourceScheduler + eager/lazy（~1天）
  |
  v
验证：order.codoc 引用 user.codoc 的 $source，TTL 过期后 order 卡片自动刷新
```

## 与其他设计的关系

- **m4-change-detection-design.md**：该文档提出的 ChangeEvent / ChangeSource 协议与本方案互补。subscribe 原语是内核层面的通知通道，ChangeSource 是外部变更感知层面的抽象。M5 的 ChangeSource 实现可以通过 `invalidateField` -> subscribe 链路接入。
- **type-codata-semantics-analysis.md**：增厚的 type 声明（costHint）可以指导 SourceScheduler 选择默认 refresh 策略。
