# @codoc/core

## Codoc 是什么

Codoc 是一种**结构化的活文档格式**。每个 `.codoc` 文件由三部分组成：

```yaml
type:   # JSON Schema — 定义文档的数据结构
data:   # 数据层 — 字段值 + 数据来源声明
view:   # MDX 模板 — 渲染层
```

核心理念：**文档即数据，数据有来源，来源可追踪、可刷新、可传播。**

字段的值不一定是静态的。每个字段通过 loader 声明自己的数据来源：

| Loader | 声明方式 | 语义 |
|--------|---------|------|
| `literal` | 直接写值 | 静态常量 |
| `ref` | `$ref: /other/field` | 引用同文档内的其他字段 |
| `source` | `$source: https://...` | 从远程 URL 拉取，支持 TTL 缓存和 stale-while-revalidate |
| `prompt` | `$prompt: { template: "..." }` | 用 LLM 生成，模板中可引用其他字段 |
| `external` | `$ref: otherDoc.codoc#/field` | 跨文档引用 |

字段之间通过引用形成 **DAG（有向无环图）**。当上游字段变更时，下游字段自动标记为 dirty 并按拓扑序重新求值。这套机制在单文档和跨文档之间一致工作。

---

## @codoc/core 提供的能力

### 1. 文档解析

```ts
import { parseCodoc } from "@codoc/core";

const codoc = parseCodoc(yamlString);
// → { type, data, view }
```

### 2. DataTree — 响应式数据树

DataTree 是 codoc 的运行时核心。它将 `type` + `data` 解析为一棵带状态机的字段树。

```ts
import { DataTree } from "@codoc/core";

const tree = new DataTree({ type: codoc.type, data: codoc.data });

// 读取字段（懒求值，首次访问触发 loader 执行）
const value = await tree.observe("/name");

// 外部写入
tree.updateField("/name", "New Name");

// 订阅变更
const unsub = tree.subscribeField("/name", () => { /* ... */ });
```

字段状态机：`idle → pending → resolved | error`，变更后可标记为 `dirty` 重新求值。

### 3. DAG — 依赖图

从 DataTree 静态提取字段间的依赖关系，构建 DAG。

```ts
import { DAG } from "@codoc/core";

const dag = DAG.buildFromTree(tree);

dag.getDirectDeps("/description");  // → ["/name", "/flavorNotes", ...]
dag.getDependents("/name");         // → ["/description"]
dag.detectCycle();                  // → null | CyclicDependencyError
```

### 4. Scheduler — 拓扑序批量求值

按 DAG 分层并行 force 所有字段，同层并发，层间串行。

```ts
import { scheduleForce } from "@codoc/core";

const result = await scheduleForce(tree, dag, { timeout: 30000 });
// → { resolved: ["/name", ...], errors: [] }
```

### 5. Dirty Propagation — 变更传播

上游字段变更后，自动沿 DAG 向下游传播 dirty 标记。

```ts
import { propagateAndInvalidate } from "@codoc/core";

// /name 变了，找出所有受影响的下游字段并标记 dirty
const dirtyPaths = propagateAndInvalidate(dag, tree, ["/name"]);
```

### 6. Cross-Doc — 跨文档引用与传播

多个 `.codoc` 文件之间可以互相引用字段，变更自动跨文档传播。

```ts
import { DocRegistry, wireExternalDeps, crossDocPropagate } from "@codoc/core";

const registry = new DocRegistry();
registry.register("a.codoc", treeA, dagA);
registry.register("b.codoc", treeB, dagB);
wireExternalDeps(registry, "b.codoc"); // b 引用了 a 的字段

// a 的字段变了 → 自动传播到 b
await crossDocPropagate(registry, "a.codoc", ["/price"]);
```

### 7. Workspace — 工作空间

扫描目录下所有 `.codoc` 文件，提供统一的索引、加载和变更监听。

```ts
import { Workspace } from "@codoc/core";

const ws = await Workspace.create("./docs");

ws.listDocs();                    // 所有文档元信息
ws.getDependencyGraph();          // 全局依赖图（含跨文档边）

const { tree, dag } = ws.loadDoc("yirgacheffe.codoc");
await scheduleForce(tree, dag);   // 求值整个文档

ws.onFieldChange((event) => {
  console.log(`${event.docId}:${event.fieldPath} changed`);
});
```

### 8. LLM 集成

`$prompt` loader 需要注入 LLM client：

```ts
import { setLLMClient } from "@codoc/core";

setLLMClient({
  generate: async ({ model, prompt, schema }) => {
    // 调用任意 LLM API，返回符合 schema 的结构化输出
  },
});
```

### 9. Schema 校验

每个字段 resolve 后自动按 `type` 中声明的 JSON Schema 校验，不符合则进入 error 状态。

```ts
import { validate } from "@codoc/core";

const result = validate({ type: "string" }, 42, "/name");
// → { ok: false, error: { kind: "validation", ... } }
```
