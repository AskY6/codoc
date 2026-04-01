# Cobook Roadmap

> 宽泛阶段规划  
> 第一阶段细化见 [mvp-cli-first.md](/Users/kxzhang/code/local-tool/codoc/mvp-cli-first.md)

## 1. 路线原则

这份 roadmap 不追求“功能列表尽量全”，而追求“每一阶段都在减少未来返工”。

排序原则如下：

- 先证明知识单元和运行时闭环成立
- 再补 AI 写入与沉淀能力
- 再抽服务、多端和交互层
- 最后扩展视图、插件和领域能力

换句话说，前面阶段优先解决“这个系统是否站得住”，后面阶段才解决“它有多丰富”。

## 2. Phase 1: CLI-First MVP

目标：

- 建立最小 codoc runtime 闭环
- 用 CLI 验证 workspace、DAG、resolve 和 AI 写入
- 明确 service boundary，避免 CLI 直接拥有底层能力

范围：

- CLI-only
- `static / file / codoc` 三种 source
- 字段级 DAG
- `build / resolve / invalidate / rebuildCodoc`
- 一个 `base-agent`

退出条件：

- 能加载 workspace
- 能解析并校验 `.codoc`
- 能跨 codoc resolve 数据
- 能通过 AI 创建或更新 codoc
- 变更后能完成重建和重新求值

细化文档：

- [mvp-cli-first.md](/Users/kxzhang/code/local-tool/codoc/mvp-cli-first.md)

## 3. Phase 2: Runtime Hardening

目标：

- 让 runtime 从“能跑”提升到“能稳定演进”

范围：

- 增量重建做扎实
- 错误状态、默认值、失效传播语义稳定
- file watch 接入
- runtime 调试信息和诊断能力

退出条件：

- codoc 结构变更能局部重建
- 值变化和结构变化的处理路径明确
- CLI 能给出足够清晰的错误与依赖信息

## 4. Phase 3: AI Authoring Workflow

目标：

- 让 AI 从“能写文件”升级到“能稳定参与知识沉淀”

范围：

- pinned codocs / project summary
- 更稳定的 codoc 生成模板
- 读、写、更新、重构 codoc 的基本动作
- AI 产物的校验与回写反馈

退出条件：

- 用户能围绕已有 codoc 持续对话
- AI 生成的 codoc 风格和结构相对稳定
- 写入失败时有明确恢复路径

## 5. Phase 4: Service Extraction And Multi-Client Foundation

目标：

- 把“嵌入式本地 service”升级成真正可复用的多客户端基础

范围：

- 抽出独立 server 进程或 RPC transport
- 统一 CLI 和未来 Web 的服务接口
- workspace session 生命周期管理
- 并发访问和状态同步基础

退出条件：

- CLI 不需要大改就能切到远端 service
- 服务接口清晰稳定
- 多客户端不会迫使 core 或 agent 重写

## 6. Phase 5: Web Experience

目标：

- 提供完整的可视化交互面，但不改变系统核心边界

范围：

- codoc list
- chat panel
- view panel
- 基础状态与事件展示

退出条件：

- Web 通过统一 service 使用 runtime
- CLI 与 Web 对同一 workspace 模型没有语义分叉

## 7. Phase 6: View And Component Expansion

目标：

- 让 codoc 不只是“能算”，还“更适合被阅读、消费和交互”

范围：

- 更完整的 view 表达形式
- 本地 component 注册
- 更成熟的渲染运行时

退出条件：

- 视图层扩展不破坏 data graph 的核心语义
- 渲染能力和运行时边界仍然清晰

## 8. Phase 7: Domain Agents And Sources

目标：

- 在稳定底座之上增加垂直场景价值

范围：

- RSS / HTTP 等更丰富的 source
- 场景 agent
- 领域工作流

退出条件：

- 领域能力是建立在通用 runtime 和 service 上的增量能力
- 不需要为某个垂直场景破坏核心抽象

## 9. Phase 8: Ecosystem And Collaboration

目标：

- 让 Cobook 从单机原型成长为可扩展系统

范围：

- source / component / agent 插件机制
- 项目级规范与模板
- 协作、共享、部署相关能力

退出条件：

- 扩展点和核心语义之间边界稳定
- 新能力可以以插件或规范形式接入，而不是反复改内核

## 10. 为什么这样排

这条路线有一个明确取舍：

- 不先追求“看起来完整”
- 先追求“底层闭环能自洽”

如果 Phase 1 到 Phase 3 没站稳，后面的 Web、场景 agent、插件生态都会变成返工放大器。  
反过来，只要前 3 个阶段稳定，后面很多能力都会变成自然加法。
