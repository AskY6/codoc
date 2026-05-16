# `apps/local` 架构分析

`@cobook/local` 是 codoc 的本地运行时——一个把 `~/.codoc/<workspace>/` 目录里的 `.codoc` 源文件解析、解析引用、定时刷新、编译成 `.mdx`，并通过 HTTP / MCP / SPA 暴露给浏览器和 AI Client 的单进程 Node 应用。

## 1. 顶层架构（进程边界）

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Browser (Vite SPA)      │        │  AI Client (Claude Code) │
│  ui/dist/*               │        │  via stdio subprocess    │
└────────────┬─────────────┘        └──────────────┬───────────┘
             │ /api/*  /mcp  /api/updates(SSE)     │ JSON-RPC over stdio
             ▼                                     ▼
┌────────────────────────────────────────────────────────────────┐
│ codoc CLI (single Node process)                                │
│                                                                │
│   src/index.ts  ──►  dispatch: start | init | add | mcp |      │
│                              compile | dag                     │
│                                                                │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│   │ server/http  │   │ server/mcp   │   │ commands/*       │   │
│   │ (Hono)       │   │ (stdio MCP)  │   │ (one-shot)       │   │
│   └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘   │
│          │                  │                    │             │
│          └─────────┬────────┘                    │             │
│                    ▼                             ▼             │
│         ┌──────────────────────────────────────────────┐       │
│         │ workspace/  (single source of truth, in-mem) │       │
│         │   index.ts   service.ts   watcher.ts         │       │
│         │   resolve.ts diagnose.ts  recognize.ts       │       │
│         │   components.ts (esbuild .tsx → CJS)         │       │
│         └──────────────────────────────────────────────┘       │
│              ▲              ▲              ▲                   │
│              │              │              │                   │
│        sources/         plugins/        providers/             │
│        (cron $source)   (RSS / default)  (claude/codex/kiro)   │
│              │              │              │                   │
│              ▼              ▼              ▼                   │
│  .source-state.json    Hono sub-router   spawn CLI / SDK       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              filesystem: ~/.codoc/<workspace>/
                ├── *.codoc            (source)
                ├── *.mdx              (compiled output)
                ├── codoc.config.json
                ├── .source-state.json
                ├── components/*.tsx   (user-authored)
                └── chats.json
```

## 2. 模块分层与依赖方向

依赖**单向向内**（来自各子目录 `AGENTS.md` 的 `Reads from / Must never import from` 声明）：

```
        ┌──────────────────────────────────────────┐
        │ index.ts  (CLI dispatcher — only top)    │
        └─────────┬─────────────┬─────────────┬────┘
                  │             │             │
         ┌────────▼────┐  ┌─────▼────┐  ┌─────▼──────┐
         │ commands/   │  │ server/  │  │ templates/ │
         │ (one-shot)  │  │ (runtime)│  │ (used by   │
         └────────┬────┘  └────┬─────┘  │  commands) │
                  │            │        └─────┬──────┘
                  │     ┌──────┼─────────┐    │
                  │     ▼      ▼         ▼    │
                  │  providers/ plugins/ sources/
                  │  (chat CLI) (vertical) (cron)
                  │     │      │         │
                  │     └──────┼─────────┘
                  ▼            ▼
              ┌──────────────────────────┐
              │ workspace/               │
              │ (single SoT — pure +     │
              │  service.ts mutations)   │
              └────────────┬─────────────┘
                           ▼
        @cobook/core   @cobook/parser   @cobook/compiler
        (ID/ADT/DAG)   (parse + $source)(MDX emit)
```

关键约束（取自各 `AGENTS.md`）：

- `workspace/` **不**导入 `server / commands / plugins / providers / templates` —— server-agnostic
- `resolve.ts / diagnose.ts / recognize.ts / patch.ts` 保持纯函数
- `commands/` **不**导入 `workspace/index.js / service.js` —— 只做 scaffold
- 全应用**不**得 import `@cobook/service`、`@cobook/storage*`、`@cobook/chat`、`@cobook/graph`（这些来自旧架构）
- 任何 mutation 都走 `workspace/service.ts` 的 "mutate → persist → recompile → notify" 循环

## 3. 数据流（最重要的一条主线）

```
   .codoc 文件          parseCodoc           resolve $ref/$source       compileCodoc
  ──────────────► AST ───────────────► resolvedData ─────────────► .mdx
        ▲                  │                    ▲                       │
        │                  │                    │                       ▼
    chokidar             diagnose          sources/state.json     writeFile (outDir)
    (300ms debounce)    (block writes)     .source-state.json
        │                                        ▲                       │
        │                                        │                       │
    用户/AI 编辑 ◄── service.updateDataField ── scheduler tick           SSE updates
                                                                          │
                                                                          ▼
                                                                    Browser 实时重渲染
```

所有写入都经过 `workspace/service.ts`，触发：parse → diagnose → write → reload → resolveAll → compileAll → `EventEmitter.emit('update')` → `/api/updates` SSE → UI。

## 4. 三个并行的"运行时循环"

| 循环 | 由谁触发 | 写入 | 通知方式 |
|---|---|---|---|
| Watcher (`workspace/watcher.ts`) | chokidar 监听 `.codoc` / `components/*.tsx` 文件改动 | 重新 parse + resolve + compile | EventEmitter → SSE |
| Source scheduler (`sources/scheduler.ts`) | 每个 `$source` 的 `interval` | `.source-state.json` + `resolvedData` | 同上 |
| Plugin jobs (`plugins/*/digest-job.ts` 等) | 插件 `startJobs()` | 通过 `service.ts` 写 codoc | 同上 |

三者共享同一份 `AppState` 和 `EventEmitter`，是 HTTP server 的生命周期附属物（`http.ts` 里 `setupMcp / startScheduler / startWatcher / plugin.startJobs`）。

## 5. 插件 / Provider 边界

- **WorkspacePlugin**（`plugins/types.ts`）：一个 workspace = 一个插件，按 `workspaceKind` 解析。提供 `parseConfig / registerMcpTools / createApiRoutes / getUiSpec / startJobs`。RSS 是首个 vertical，`default` 是 no-op fallback。
- **ChatProvider**（`providers/types.ts`）：把 Claude Code / Codex / Kiro CLI 翻译成统一的 `ChatEvent` SSE 流。`registry.ts` 在启动时并行探测可用 binary。
- 这两个是 host 与 vertical 的**双向解耦**：host 不知道 RSS，plugin 不知道 schedule / CRUD / DAG。

## 6. 关键设计决策（来自 `AGENTS.md`，作为"为什么"）

- **没有 storage 层** —— 文件就是持久化，不引入 DB/ORM
- **没有 thread/session 存储** —— 由 Claude Code 等 CLI 拥有
- **Compile 输出自包含** —— `.mdx` 把数据作为 ES module 导出，浏览器无需再去 resolve
- **统一 CLI** —— `codoc start` 同进程跑 HTTP + watch + MCP；`codoc mcp` 单独保留是因为 Claude Code 用 subprocess 模型
- **Custom components** —— `.codoc/components/*.tsx` 由服务端用 esbuild 编译为 CJS，前端用 mock `require()` 在浏览器里 eval，shadcn 式"代码归你"
- **Resolution 是 workspace-global** —— 所有 sibling 一起参与 DAG，便于跨文件 `$ref`

## 7. 一句话总结

`apps/local` 是一个**文件即持久化、workspace 是内存 SoT、HTTP+MCP 共生进程**的本地 codoc 工作站；通过 `workspace/service.ts` 的统一 mutation 出口、`plugin` 的纵向能力包、`provider` 的 CLI 适配器，把"原始 .codoc → 解析 → 编译 → 推送给浏览器和 AI"这条主线干净地分到四个互不交叉的子树里。
