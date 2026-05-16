# docs/

Parent: `AGENTS.md`
Reads from: `AGENTS.md`, code files and docs explicitly referenced by the current document
Must never import from: `docs/` 不是运行时真相来源；实现细节必须回到源码核对

## Purpose

存放产品设计、架构说明、执行计划、端到端验证脚本。

## Conventions

- 一份文档只承载一个主题：设计、路线图、执行单、E2E 脚本不要混写
- 文档必须区分“当前状态”和“目标状态”，避免把愿景写成已实现事实
- 如果文档开始大量描述某个具体子树的实现细节，应把文档下沉到对应子树附近，而不是继续堆在 `docs/`
- 产品/规划文档默认用中文；如面向外部读者再切英文
- 引用代码时优先给出具体文件路径，避免只写模块名
