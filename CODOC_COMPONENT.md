# CoDoc Components 设计

---

## 一、.codoc 文件结构（修订）

原设计为三部分（type, data, view），修订为四部分：

```
.codoc = {
  meta: {
    data:       JSON Schema (含 description)     // 数据结构 + 语义描述
    components: 组件签名集合 (含 description)      // 组件能力 + 语义描述
    view:       待定
  }
  data:         JSON 值 + loader 声明
  components:   bundle 引用集合
  view:         MDX 模板
}
```

**变化说明：**

**type 升级为 meta。** 原来的 type 只描述 data 的结构。meta 是整个 codoc 的自描述层，覆盖 data、components、view 三部分的元信息。meta 不是与其他三部分并列的内容层，而是高一层的描述层。

**components 独立成部分。** 原设计中组件在 runtime 全局注册，codoc 本身不声明。现在每个 codoc 显式声明自己使用的组件集合——从"全局隐式依赖"变为"局部显式声明"，与 data 中 `$ref` 显式声明数据依赖的设计原则一致。

---

## 二、Components Meta：签名 + 语义

Components 的 meta 是带 description 的组件签名集合。

设计原则与 data 的 JSON Schema 完全一致：**结构定义 + 自然语言语义**。结构定义给机器做 validation，自然语言语义给 agent（和人）理解意图。

示例：

```
meta.components: {
  Chart: {
    props: {
      data:  { type: "DataPoint[]", description: "图表数据源" },
      xAxis: { type: "string",      description: "数据集中用作横轴的字段名" },
      yAxis: { type: "string",      description: "数据集中用作纵轴的字段名" }
    },
    description: "通用数据可视化图表，支持折线、柱状、散点等类型"
  }
}
```

**对 agent 的价值：** agent 写 view 时，data 的 meta 告诉它"有什么数据"，components 的 meta 告诉它"有什么 UI 能力、每个能力接受什么参数"。两份 meta 构成 agent 生成 view 的完整上下文。

---

## 三、Components 本体：Bundle 引用

Components 本体是 bundle 引用，支持三种来源：

**Workspace 组件库引用（主要方式）：**
```
Chart: { from: "workspace://ui-kit/Chart" }
```

**本地 bundle：**
```
CustomWidget: { bundle: "./components/CustomWidget" }
```

**远程 bundle（锁版本）：**
```
DataTable: { bundle: "registry://ui-kit/DataTable@1.2.0" }
```

远程 bundle 必须锁版本。同一个引用必须拿到同一份代码，否则文档的渲染行为不可预测。这与 data 的 `$source`（运行时可能拿到不同结果）性质不同。

---

## 四、跨文档引用：Workspace 组件库

两层模型：

**Workspace 级：** 组件库是共享的组件集合，持有签名 + description + bundle，是组件的 source of truth。

**Codoc 级：** 通过轻量引用从 workspace 组件库选取组件。不重复声明签名——meta 自动从组件库继承。codoc 只声明"我用了哪些组件"，不描述"这些组件长什么样"。

**例外：** codoc 自有的本地或远程组件，仍需在自己的 meta 中声明签名。

---

## 五、Components 引用 vs Data 引用

两种跨文档引用性质不同：

| | Data 引用 | Components 引用 |
|---|---|---|
| 引用的是 | 值 | 能力 |
| 依赖性质 | 运行时依赖 | 静态依赖 |
| 变更响应 | 标脏传播（observe → force → propagate） | 兼容性检查（静态校验） |
| 所属层 | value 层 | meta 层 |

Components 签名是静态类型信息，不是运行时动态产生的值。签名变更（如组件新增必填 prop）导致的 view 兼容性问题，是编译期 / 加载期的静态检查，不走计算图的传播路径。

这符合已确立的架构原则：**meta 层是静态的，value 层是动态的。** Relation engine 从 meta 层静态建图，标脏传播发生在 value 层。Components 的变更属于 meta 层，走静态检查。