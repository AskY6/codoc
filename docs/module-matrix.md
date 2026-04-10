# 模块交叉矩阵

项目从两个维度拆分：

- **技术环境**：Web、CLI、Server、Database
- **逻辑模块**：Workspace、Codoc、Chat、Agent

## 交叉矩阵

|  | **Web** | **CLI** | **Server** | **Database** |
|---|---------|---------|------------|-------------|
| **Workspace** | 列表页、masthead、sidebar | `workspaces`, `init`, `status`, `watch` | session 管理、file watcher、build 编排 | workspaces 表（注册信息、元数据） |
| **Codoc** | detail panel（view + data + node states） | `list`, `show`, `build`, `resolve`, `graph` | parser → DAG → source executor → resolver，CRUD 边界 | codocs 表（AST + content）、edges 表（字段级依赖） |
| **Chat** | chat panel（input + transcript）、AI Elements 流式渲染 | `chat [--agent] [--pin]` 终端流式 | 消息编排：持久化 → 调 agent → 收集事件 → 持久化回复 | chat\_threads 表、messages 表 |
| **Agent** | agent picker 下拉、描述展示 | `--agent <id>` 参数 | RouterAgent 路由、BaseAgent 通用能力、SceneAgent 垂直场景 | agent\_sessions 表（场景状态） |

## 厚薄分布

```
            Web    CLI    Server    Database
Workspace   ░      ░      ██░       ░
Codoc       ░░     ░      ████      ██
Chat        ░░     ░      ███       ██
Agent       ░      ░      ████      ░
```

Server 是所有逻辑模块的重心。Web 和 CLI 在每个模块上都只是薄壳——接收输入、展示输出。

## 模块依赖方向

```
workspace ← codoc ← chat
                      ↑
                    agent
```

- **Workspace** 是基础——必须先有 workspace 才能谈其他
- **Codoc** 依赖 workspace（codoc 存在于 workspace 内）
- **Chat** 依赖 codoc（对话的上下文是 codoc，产出也是 codoc）
- **Agent** 是 chat 的执行者——chat 把消息交给 agent，agent 通过 service 操作 codoc

## 技术环境之间的通信边界

```
Web ──HTTP──▸ Server ──SQL──▸ Database
CLI ──RPC───▸ Server ──SQL──▸ Database
```

四个逻辑模块共享同一通信边界。不存在某个模块走不同的通道。

- `CobookService` 接口是所有模块的统一 API 面——workspace / codoc / chat / agent 的方法全在一个接口上
- Web 的 api-client 和 CLI 的 RPC client 是同构的，只是传输层不同

## 每个格子的本质

| 层 | 本质 |
|---|------|
| **Web x 任何模块** | 渲染 + 用户输入采集 |
| **CLI x 任何模块** | 格式化输出 + 命令解析 |
| **Server x 任何模块** | 状态管理 + 业务逻辑 + 副作用执行 |
| **Database x 任何模块** | 持久化 + 查询 |

真正需要设计的只有 Server 那一列——其他三列的复杂度都由 server 的接口形状决定。

## 对代码组织的指导

- **薄层按技术环境拆包** — `apps/web`、`apps/cli`、`apps/server`，内部不需要按模块拆子包，因为每个模块在里面都只是一两个文件
- **厚层按逻辑模块组织目录** — `packages/service` 内部按 `workspace/`、`codoc/`、`ai/`（chat + agent）组织子目录
- **Database 跟随 server** — schema 和 repository 是 service 的内部实现，不需要独立成顶层维度

结论：**技术环境决定包边界，逻辑模块决定包内目录结构。两个维度不是对等的。**
