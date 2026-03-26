# CoDoc 涉及的核心领域

---

## 1. Reactive/Dataflow Computing

CoDoc 的计算模型本质上是一个响应式数据流系统。字段之间通过 `$ref` 形成依赖图，上游变更触发下游重算，类似 Excel 的公式求值但计算单元是语义字段。

关键词：reactive programming、dataflow graph、topological sort、incremental computation、change propagation

可参考的成熟系统：Excel 公式引擎、MobX/SolidJS 的响应式模型、Adapton（增量计算框架）、Svelte 的 reactivity model

---

## 2. Dependency Analysis / Graph Computing

CoDoc 文档间通过内联引用形成 DAG。需要依赖发现（从 data 中提取 `$ref`）、循环检测、拓扑排序、增量通知、变更溯源。

关键词：dependency graph、DAG、cycle detection、topological ordering、incremental graph update

可参考的成熟系统：包管理器（npm/cargo 的依赖解析）、构建系统（Bazel/Nx 的增量构建）、数据库的 materialized view refresh

---

## 3. JSON Schema / Structured Data Contract

type 定义采用 JSON Schema 作为 Agent 和 CoDoc 之间的契约。涉及 schema 设计、validation、schema evolution（版本演进）、自描述性。

关键词：JSON Schema、schema validation、schema evolution、structured output、Zod

可参考的成熟系统：OpenAPI spec、LLM Structured Output（Claude/OpenAI）、Zod/Pydantic 的类型系统、Protocol Buffers 的 schema evolution

---

## 4. MDX / Computable Document Rendering

view 层是 markdown + jsx 的混合模板，需要解析 MDX、挂载组件、绑定已求值的 data。涉及 MDX 编译、组件注册、lazy render。

关键词：MDX、JSX runtime、component registry、lazy rendering、SSR/CSR

可参考的成熟系统：MDX 编译器（@mdx-js/mdx）、Next.js 的 MDX 支持、Docusaurus、Obsidian 的渲染架构

---

## 5. Data Fetching / Remote Data Source Management

data 中的 `$source` 声明涉及远程数据获取、缓存策略、刷新时机、快照管理。核心难点是不确定性数据源的生命周期管理。

关键词：data fetching、cache invalidation、stale-while-revalidate、refresh strategy、snapshot

可参考的成熟系统：React Query/TanStack Query、SWR、Apollo Client 的 cache 策略、dbt 的 materialization strategy

---

## 6. LLM Integration / AI-Native Document

`<Prompt />` 组件将 LLM 调用嵌入计算图，涉及 prompt 管理、结果缓存、token 成本控制、生成质量保障。Agent 读写 CoDoc 涉及 Structured Output、schema-constrained generation。

关键词：LLM structured output、prompt management、schema-constrained generation、AI-friendly format

可参考的成熟系统：Claude/OpenAI Structured Output API、LangChain 的 output parser、Instructor（schema-constrained LLM output）

---

## 7. Document-as-Application Runtime

CoDoc 是应用不是文档，需要一个 web runtime 来执行 compute → render 的管道。涉及应用生命周期、状态管理、组件沙箱。

关键词：document runtime、application lifecycle、sandboxed execution、state management

可参考的成熟系统：Observable（computable notebook）、Jupyter 的 kernel 架构、Figma 的插件沙箱、Obsidian 的 plugin runtime
