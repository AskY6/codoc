# codoc

## 工作模式（项目级授权）
codoc 是实验性实现项目，授权 Claude 在本目录下按"高自治"模式工作：
- **免确认**：编辑/写文件、跑测试、本地 git 操作（commit/branch/checkout/stash/rebase 非交互）、`pnpm` / `npx` / `tsx` / `node` / `docker compose` 本地容器、起停 dev server、`curl` 本地端口、读类 `gh`（view/list/diff/checks/api）、本地数据库读写（psql/sqlite3）、`kill` 本机进程、`rm` 本目录内文件
- **仍需先问**：`git push`（任何远端写）、`gh pr create/merge/close`、`gh release`、`npm/pnpm publish`、修改 `~/` 之外的共享资源、删除未提交的工作、`sudo`、改 CI/CD 配置生效到远端
- **遇阻不绕**：失败时定位根因，不用 `--no-verify` / `--force` 绕过；不熟悉的状态先调查再删

## design pattern
1. 代数数据类型优先
2. 整洁架构优先

## packages/core 分层约束
- 模块依赖方向严格向内：`dag → codoc`、`cobook → codoc`（只引用 ID 类型），`codoc` 不依赖任何兄弟模块
- `codoc/` 和 `dag/` 不能出现 `workspaceId` 或任何 cobook 概念，租户边界只属于 `cobook/`
- 跨层关联（如 `ThreadCodoc`）放在 `cobook/`，通过 `CodocId` 不透明地引用 codoc
- core 不持有时间戳 / 行元数据（`createdAt`、`updatedAt` 等），这是 storage 层的职责
- ID 一律使用 branded type，编译期防止 `CodocId` / `WorkspaceId` / `NodeId` 混用
- 纯函数返回 `Result<T, E>`，不抛异常；非法状态用 ADT 消除而不是靠运行时校验
- core 零运行时依赖，零 `node:*` / 文件系统 / 网络引用

## 文档组织（tree-based context）
- 每个有独立语义的目录放一份 `AGENTS.md`，与目录树同构；`README.md` 留给人类，`AGENTS.md` 面向 AI
- 每份 `AGENTS.md` 开头显式声明 `Parent: ...`、`Reads from: ...`、`Must never import from: ...`，让 AI 不读代码就能判断子树边界
- 摘要向上 / 细节向下：父节点只持有子节点索引和跨模块契约，不复述子节点细节；子节点不复述父节点规则
- 任何任务开始前先读最近的 `AGENTS.md` 下钻到目标子树，只加载路径上的 md，不相关的 sibling 子树完全不进上下文
- 从零写 `AGENTS.md`、或遇到拆分 / 合并决策时，调用 `.claude/skills/tree-context/SKILL.md` 做深度参考
- **新建目录 = 同时写 AGENTS.md**，视为与代码同等的交付物；提交前检查是否有新目录缺少 AGENTS.md，缺失则视同 typecheck 未通过