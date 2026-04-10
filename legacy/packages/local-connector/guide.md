# web-local-connector 使用指南

## 它是做什么的

`web-local-connector` 让一个运行在浏览器里的 Web 产品，在用户明确授权之后，访问本机某个目录中的内容。

当前 Phase 1 主要适合这类场景：

- Web 页面需要读取本地项目目录
- Web 页面需要读取本地文档目录
- Web 页面需要监听本地文件变化

它不适合这类场景：

- 执行本地命令
- 修改或删除本地文件
- 代理内网请求
- 替代完整桌面应用

## 你能得到什么能力

当前版本只支持：

- 读取目录
- 读取文本文件
- 监听文件变化

当前版本不支持：

- 写文件
- 删文件
- 重命名
- 命令执行
- 浏览器控制

## 最短使用路径

如果你只是想快速体验，直接执行：

```bash
pnpm smoke
```

然后打开：

```text
http://127.0.0.1:5173/examples/smoke-web/index.html
```

这个命令会同时启动：

- 本地 daemon：`ws://127.0.0.1:3999`
- demo 页面服务：`http://127.0.0.1:5173`

## 一次完整的使用流程

1. 在仓库根目录运行：

```bash
pnpm smoke
```

2. 浏览器打开：

```text
http://127.0.0.1:5173/examples/smoke-web/index.html
```

3. 点击页面里的 `Connect`

4. 回到 daemon 所在终端，批准授权

5. 输入一个本地绝对目录作为授权 root，例如：

```text
/Users/kxzhang/.claude/projects
```

6. 回到页面后开始操作：

- `ReadDir`：读取某个相对目录
- `ReadFile`：读取某个相对文件
- `Start Watch`：监听某个相对目录或文件

## 路径怎么填

这里有两个路径概念：

### 1. 授权时输入的路径

这是本地真实目录，必须是绝对路径，例如：

```text
/Users/kxzhang/.claude/projects
```

不要输入：

```text
~/.claude/projects
```

当前实现不会自动展开 `~`。

### 2. 页面里输入的路径

这是相对于授权 root 的相对路径，例如：

- `.` 代表授权 root 本身
- `project-a`
- `project-a/README.md`
- `notes/todo.txt`

不要输入绝对路径，也不要输入 `..`。

## 常见操作

### 读取授权根目录

在 `Directory Path` 里填：

```text
.
```

然后点击 `ReadDir`。

### 读取某个文件

如果你授权的是：

```text
/Users/kxzhang/.claude/projects
```

而你要读的是：

```text
/Users/kxzhang/.claude/projects/demo/config.json
```

那么页面里应填写：

```text
demo/config.json
```

然后点击 `ReadFile`。

### 监听目录变化

在 `Watch Path` 里填：

```text
.
```

或某个子目录，例如：

```text
demo
```

点击 `Start Watch` 之后，在授权目录内修改文件，页面日志区会显示变化事件。

## 如果授权错了目录怎么办

当前授权会记住，不会每次都重新问。

如果你之前已经授权给错误目录，需要先撤销授权，再重新连接。

### 查看当前授权

```bash
node dist/daemon/main.js grants list
```

### 撤销某个授权

```bash
node dist/daemon/main.js grants revoke <origin> <clientId>
```

例如 demo 页面：

```bash
node dist/daemon/main.js grants revoke http://127.0.0.1:5173 smoke-web
```

撤销后，重新打开页面并点击 `Connect`，daemon 会再次询问授权目录。

## 为什么我换了 localhost / 127.0.0.1 之后要重新授权

因为授权是按下面两个值绑定的：

- `Origin`
- `clientId`

所以这两个地址在系统里不是同一个来源：

- `http://127.0.0.1:5173`
- `http://localhost:5173`

建议始终固定使用：

```text
http://127.0.0.1:5173
```

## 如果只想单独启动 daemon

先构建：

```bash
pnpm build
```

再启动 daemon：

```bash
node dist/daemon/main.js start
```

如果你想查看授权：

```bash
node dist/daemon/main.js grants list
```

## 浏览器项目如何接入

浏览器端通过 `ConnectorClient` 使用：

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

await connector.connect()

const entries = await connector.filesystem.readDir('.')
const file = await connector.filesystem.readFile('README.md')
```

连接状态包括：

- `idle`
- `connecting`
- `auth_pending`
- `ready`
- `reconnecting`
- `closed`

通常你最需要关心的是：

- `auth_pending`：正在等待用户在终端批准
- `ready`：已经可以正常使用

## 常见问题

### 1. 页面一直连不上

先确认：

- 你是否已经运行了 `pnpm smoke`
- daemon 是否已经打印 `Local Connector listening on ws://127.0.0.1:3999`

### 2. 授权了但还是读不到文件

先确认：

- 页面里填的是相对路径，不是绝对路径
- 路径没有使用 `..`
- 目标文件确实在授权目录下

### 3. 为什么读不了二进制文件

因为当前 Phase 1 只支持文本文件读取。

### 4. 为什么 Safari 不工作

因为当前 Phase 1 还没有做 Safari 兼容和 relay 模式。