# web-local-connector

`web-local-connector` 是一个本地 daemon + 浏览器 SDK 的组合，用来让远端 Web 产品在用户授权后访问本机受控目录中的文件。

当前实现是 Phase 1，目标是验证最小可用闭环：

- 浏览器连接本机 daemon
- 首次连接时在终端完成授权
- 已授权产品可读取文件和目录
- 已授权产品可监听文件变化

## 当前能力

Phase 1 只支持 `filesystem` capability，权限只有：

- `read`
- `watch`

当前不支持：

- `write`
- `rename`
- `delete`
- `execute`
- `browser`
- `network-proxy`
- relay 模式

## 环境要求

- Node.js 20+
- `pnpm`

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

## 构建

```bash
pnpm build
```

## 一键启动 Smoke Demo

最简单的使用方式是直接启动 demo：

```bash
pnpm smoke
```

这条命令会同时启动：

- daemon：`ws://127.0.0.1:3999`
- 静态 web 页面：`http://127.0.0.1:5173/examples/smoke-web/index.html`

按 `Ctrl+C` 会同时停止两者。

## Demo 使用流程

1. 执行 `pnpm smoke`
2. 打开：
   `http://127.0.0.1:5173/examples/smoke-web/index.html`
3. 点击 `Connect`
4. 在 daemon 所在终端中批准授权
5. 输入一个本地绝对目录作为授权 root
6. 回到页面测试：
   `ReadDir`
   `ReadFile`
   `Start Watch`

注意：

- 当前授权 root 必须输入绝对路径
- 不支持直接输入 `~/.claude/projects`
- 应输入完整路径，例如 `/Users/kxzhang/.claude/projects`

## Browser SDK 用法

浏览器侧通过 `ConnectorClient` 接入：

如果你的 Web 项目以 workspace、本地路径依赖或发布包的形式引入本库，可以这样使用：

```ts
import { ConnectorClient } from '@company/local-connector'

const connector = new ConnectorClient({
  clientId: 'product-a',
  productName: 'Product A',
  capabilities: [
    {
      type: 'filesystem',
      permissions: ['read', 'watch']
    }
  ]
})

connector.onStatusChange((status) => {
  console.log('status:', status)
})

await connector.connect()

const entries = await connector.filesystem.readDir('.')
const file = await connector.filesystem.readFile('README.md')

for await (const event of connector.filesystem.watch('.')) {
  console.log(event.kind, event.path)
}
```

### 连接状态

浏览器侧状态有：

- `idle`
- `connecting`
- `auth_pending`
- `ready`
- `reconnecting`
- `closed`

含义：

- `auth_pending`：正在等待终端授权
- `ready`：已完成握手并可访问授权目录
- `reconnecting`：连接断开，客户端正在自动重连

## CLI 用法

### 启动 daemon

```bash
node dist/daemon/main.js start
```

如果你通过 `pnpm exec` 调用本地 bin，也可以执行：

```bash
pnpm exec local-connector start
```

如果后续全局安装了这个包，也可以执行：

```bash
local-connector start
```

### 查看当前授权

```bash
node dist/daemon/main.js grants list
```

### 撤销授权

如果你之前把某个产品授权到了错误目录，需要先撤销授权，再重新连接：

```bash
node dist/daemon/main.js grants revoke <origin> <clientId>
```

例如 smoke demo：

```bash
node dist/daemon/main.js grants revoke http://127.0.0.1:5173 smoke-web
```

撤销后重新点击 `Connect`，daemon 会再次要求授权。

## 授权模型

当前授权键是：

- `Origin`
- `clientId`

这意味着：

- 同一个 `clientId`，如果 `Origin` 不同，会被视为不同授权
- `http://127.0.0.1:5173` 和 `http://localhost:5173` 不是同一个授权

建议：

- 在本地调试时始终使用 `127.0.0.1`
- 不要在 `localhost` 和 `127.0.0.1` 之间切换

## 路径规则

客户端 API 中传入的都是相对路径，而不是本地绝对路径：

```ts
await connector.filesystem.readDir('.')
await connector.filesystem.readFile('src/index.ts')
```

说明：

- 相对路径是相对于授权 root 解析的
- 当前实现允许 `.` 代表授权 root
- 不允许绝对路径
- 不允许 `..` 穿越

## 当前限制

Phase 1 有几个明确限制：

- 只支持一个授权 root
- 只支持文本文件读取
- 不处理 symlink escape
- 不保证断线期间的 `watch` 事件完整性
- Safari 暂不支持
- 当前授权交互发生在终端，不是 GUI

## 仓库入口

主要入口如下：

- 浏览器 SDK：[src/client/browser.ts](/Users/kxzhang/code/local-tool/web-local-connector/src/client/browser.ts)
- daemon server：[src/daemon/server.ts](/Users/kxzhang/code/local-tool/web-local-connector/src/daemon/server.ts)
- daemon CLI：[src/daemon/main.ts](/Users/kxzhang/code/local-tool/web-local-connector/src/daemon/main.ts)
- 协议与类型：[src/shared/types.ts](/Users/kxzhang/code/local-tool/web-local-connector/src/shared/types.ts)
- smoke demo：[examples/smoke-web/index.html](/Users/kxzhang/code/local-tool/web-local-connector/examples/smoke-web/index.html)

## 开发命令

```bash
pnpm check
pnpm build
pnpm smoke
```

## 相关文档

- Phase 1 计划：[PHASE1_PLAN.md](/Users/kxzhang/code/local-tool/web-local-connector/PHASE1_PLAN.md)
- Smoke 脚本说明：[scripts/README.md](/Users/kxzhang/code/local-tool/web-local-connector/scripts/README.md)
