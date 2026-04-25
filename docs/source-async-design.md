# $source 异步资源模型设计

> 前置：`rss-v2-design.md` Phase 1 实现过程中发现 `refreshInterval` / `lastFetchedAt`
> 作为独立 data field 存在不合理，应绑定到 `$source` 声明本身。
> 本文档从通用异步资源视角分析 `$source` 的分类和参数设计。

---

## 1. 问题

当前 `$source` 只有一种行为：resolve 时执行 provider，拿到结果，结束。
不支持定时刷新、缓存过期等异步资源的常见模式。

RSS 场景暴露了这个缺陷：feed 需要定期拉取，但 `$source` 没有调度能力，
导致 `refreshInterval` 和 `lastFetchedAt` 被迫作为同级 data field 存在，
与 `$source` 语义上是一件事，结构上却是分离的。

---

## 2. 分类：三种获取策略

从"何时获取"和"缓存策略"两个维度，`$source` 的行为可归纳为三类：

### 2.1 One-shot（一次性）

获取一次，永久缓存。当前默认行为。

```yaml
data:
  stats:
    $source: http-json
    url: "https://api.example.com/stats"
```

- **触发时机**：`resolveAll()` 执行时
- **缓存**：永久，直到文件变更或 workspace 重新加载
- **额外参数**：无
- **适用场景**：静态或变化极慢的外部数据

### 2.2 Lazy + TTL（按需 + 过期）

首次访问时获取，缓存一段时间，过期后下次访问重新获取。

```yaml
data:
  weather:
    $source: http-json
    url: "https://api.weather.com/current"
    ttl: 60  # 缓存 60 分钟
```

- **触发时机**：值被读取时，如果缓存已过期
- **缓存**：`ttl` 分钟内有效
- **运行时状态**：`fetchedAt`（由 resolve 层管理）
- **适用场景**：按需且调用代价高的接口，不需要实时但需要合理新鲜度

### 2.3 Periodic（周期主动）

后台定时获取，不管有没有人读。

```yaml
data:
  articles:
    $source: rss
    url: "https://hnrss.org/frontpage"
    interval: 30  # 每 30 分钟主动拉取
```

- **触发时机**：后台 scheduler 按 `interval` 驱动
- **缓存**：始终保有最近一次结果
- **运行时状态**：`lastFetchedAt`（由 scheduler 管理）
- **适用场景**：RSS feeds、监控面板、需要持续跟踪的流式数据

### 对比

| | One-shot | Lazy + TTL | Periodic |
|---|---|---|---|
| 声明参数 | 无 | `ttl` | `interval` |
| 运行时状态 | 无 | `fetchedAt` | `lastFetchedAt` |
| 后台调度 | 不需要 | 不需要 | 需要 scheduler |
| 数据新鲜度 | 手动控制 | 访问时按需 | 持续保鲜 |

---

## 3. 写入策略（正交维度）

获取策略描述"何时拉"，写入策略描述"拉到后怎么写"：

| 策略 | 行为 | 适用 |
|------|------|------|
| **Replace** | 新值完全覆盖旧值 | 默认，适合大多数 API |
| **Merge** | 新值与旧值合并 | 追加型数据（RSS articles） |

Merge 本质上是 provider 特异的：
- RSS：按 `link` 去重，保留已有条目的用户状态（`readAt`、`starred`）
- 其他 provider 可能完全不同

**设计决策**：不在 `$source` 协议层硬编码 merge 策略。
默认 replace；需要 merge 的场景由 provider 或 scheduler 层处理。

---

## 4. DataField 类型变更

```typescript
export type DataField =
  | { readonly kind: "static"; readonly value: unknown }
  | { readonly kind: "ref"; readonly ref: Ref }
  | {
      readonly kind: "source";
      readonly source: string;
      /** Provider-specific params (url, path, etc). */
      readonly params: Readonly<Record<string, unknown>>;
      /** Periodic refresh interval in minutes. */
      readonly interval?: number;
      /** Cache TTL in minutes (lazy revalidation). */
      readonly ttl?: number;
    };
```

关键约束：
- `interval` 和 `ttl` 由 parser 从 YAML `$source` 声明中提取，**不传给 provider**
- Provider 的 `execute(params)` 只收到业务参数（`url`、`limit` 等）
- 调度逻辑只看 `interval` / `ttl`，不关心 provider 细节

---

## 5. 运行时状态管理

`lastFetchedAt` / `fetchedAt` 是运行时状态，不是用户声明。
不应写入 `.codoc` 文件（污染声明式内容）。

**方案**：独立状态文件 `.codoc/.source-state.json`

```json
{
  "sources/hacker-news.codoc#data.articles": {
    "lastFetchedAt": "2026-04-25T08:30:00Z"
  },
  "sources/simon-willison.codoc#data.articles": {
    "lastFetchedAt": "2026-04-25T09:00:00Z"
  }
}
```

- 按 `codocPath#data.fieldName`（即 DAG NodeId）索引
- Scheduler / resolve 层读写此文件
- 丢失后果：下次启动时所有 source 立即重新获取（可接受）

---

## 6. YAML 声明示例

### RSS feed（periodic）

```yaml
# sources/hacker-news.codoc
meta:
  title: Hacker News
  tags: [source, rss]
data:
  articles:
    $source: rss
    url: "https://hnrss.org/frontpage"
    interval: 30
```

### API 数据（lazy + TTL）

```yaml
# dashboards/api-stats.codoc
data:
  latency:
    $source: http-json
    url: "https://internal-api/metrics/p99"
    path: "data.latency_ms"
    ttl: 15
```

### 静态引用（one-shot，当前行为不变）

```yaml
data:
  config:
    $source: http-json
    url: "https://cdn.example.com/config.json"
```

---

## 7. Scheduler 架构

```
Server 启动
  └→ 加载 workspace
      └→ 扫描所有 source field
          ├→ 有 interval → 注册到 periodic scheduler
          ├→ 有 ttl → 标记为 lazy（resolve 时按需检查）
          └→ 都没有 → one-shot（保持当前行为）

Periodic Scheduler（每 60s 检查一轮）
  └→ 遍历已注册的 source field
      └→ 对比 lastFetchedAt + interval
          ├→ 未到期 → skip
          └→ 到期 → execute provider
                     → merge / replace
                     → 更新 resolved data
                     → 更新 .source-state.json
                     → 触发 compile
```

---

## 8. 分阶段实现

### Phase 1 — Periodic（当前 RSS 场景驱动）

1. core `DataField` 加 `interval?: number`
2. Parser 从 `$source` YAML 提取 `interval`，不传给 provider
3. Scheduler 扫描带 `interval` 的 source field，按 node 级别计时
4. `.source-state.json` 持久化 `lastFetchedAt`
5. RSS template 改用 `$source: rss` + `interval: 30`

**验收**：打开 RSS workspace → 文章自动填充，每个 feed 按各自 interval 刷新

### Phase 2 — Lazy + TTL

1. core `DataField` 已有 `ttl?: number`（Phase 1 预留）
2. Resolve 层在执行 source provider 前检查 TTL
3. 未过期 → 返回缓存值；过期 → 重新执行 provider

### Phase 3 — Merge 抽象

1. SourceProvider 接口扩展：可选 `merge(existing, incoming)` 方法
2. RSS provider 实现 merge（按 link 去重，保留 readAt）
3. Scheduler 优先使用 provider merge，fallback 到 replace

---

## 9. 决策记录

1. **`interval` / `ttl` 属于 DataField，不属于 provider params** —
   它们是调度元数据，provider 是纯函数，不应感知调度。

2. **运行时状态不写入 .codoc 文件** —
   codoc 文件是用户声明；`lastFetchedAt` 是运行时状态，存独立文件。
   丢失代价低（最多重新 fetch 一次）。

3. **Merge 不进 $source 协议层** —
   Merge 是 provider 特异的行为，在协议层硬编码 merge 策略会过早泛化。
   Phase 1 由 scheduler 对已知 provider 做特殊处理，Phase 3 再抽象到 provider 接口。

4. **Phase 1 只实现 periodic** —
   TTL 留为类型上的可选字段但不实现，保证 core 模型一步到位，实现分步走。
