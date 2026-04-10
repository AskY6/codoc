# Phase 1 实现计划

## 1. 目标

Phase 1 的目标不是做完整平台，而是验证最小可用闭环：

- 远端 Web 页面可连接本机 daemon
- 首次连接可完成授权
- 已授权产品可读取受控目录中的文件和目录
- 已授权产品可监听文件变化
- daemon 重启或连接断开后，客户端可自动重连

Phase 1 明确不做：

- `write` / `rename` / `delete`
- `execute` / `browser` / `network-proxy`
- Relay 模式
- Safari 兼容方案
- symlink `realpath` 加固
- Windows 路径语义完整支持
- 多 root 授权
- 可视化授权管理 UI

## 2. 方案收敛

按当前建议，Phase 1 采用单 package 设计：

- 只维护一个 npm 包，例如 `@company/local-connector`
- 浏览器 SDK、Node 调试入口、daemon 入口、共享协议类型都放在同一个 package 内
- 通过 `package.json` 的 `exports` 管理不同运行环境的导出

这样做的收益：

- 降低早期仓库管理和版本管理复杂度
- 协议类型天然共享，减少 cross-package 漂移
- Phase 1 更适合快速验证

这样做的代价：

- 包内职责较多，后续若发展为稳定平台，可能要再拆分 `client` / `protocol` / `daemon`

结论：

- Phase 1 采用单 package 合理
- 但目录结构仍要按模块边界拆开，避免后续重构成本过高

## 3. 仓库结构

建议初始结构如下：

```text
.
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── PHASE1_PLAN.md
├── src/
│   ├── shared/
│   │   ├── protocol.ts
│   │   ├── schema.ts
│   │   ├── errors.ts
│   │   └── types.ts
│   ├── client/
│   │   ├── browser.ts
│   │   ├── connection.ts
│   │   ├── rpc.ts
│   │   ├── filesystem.ts
│   │   └── reconnect.ts
│   ├── daemon/
│   │   ├── main.ts
│   │   ├── server.ts
│   │   ├── gateway.ts
│   │   ├── guard.ts
│   │   ├── approval.ts
│   │   ├── grants.ts
│   │   ├── heartbeat.ts
│   │   ├── session.ts
│   │   ├── filesystem.ts
│   │   └── watch.ts
│   └── node/
│       └── index.ts
└── test/
    ├── unit/
    ├── integration/
    └── e2e/
```

说明：

- `shared/` 放协议、错误码、公共类型
- `client/` 放浏览器 SDK
- `daemon/` 放本地进程实现
- `node/` 只保留调试和测试侧入口，避免和浏览器 SDK 混淆

## 4. package.json 导出设计

建议导出策略如下：

```json
{
  "name": "@company/local-connector",
  "type": "module",
  "bin": {
    "local-connector": "./dist/daemon/main.js"
  },
  "exports": {
    ".": {
      "browser": "./dist/client/browser.js",
      "default": "./dist/client/browser.js"
    },
    "./client": {
      "browser": "./dist/client/browser.js",
      "default": "./dist/client/browser.js"
    },
    "./node": "./dist/node/index.js",
    "./daemon": "./dist/daemon/main.js",
    "./shared": "./dist/shared/types.js"
  }
}
```

约束：

- Web 产品默认只使用 `@company/local-connector` 或 `@company/local-connector/client`
- 本地调试脚本可使用 `@company/local-connector/node`
- CLI 启动使用 `local-connector start`

注意：

- `./daemon` 只是内部或调试导出，不建议业务侧依赖
- `./shared` 仅用于内部测试或调试，不作为长期公开 API 承诺

## 5. 依赖建议

核心依赖：

- `typescript`
- `tsup`
- `ws`
- `zod`
- `chokidar`
- `pino`
- `env-paths`
- `nanoid`

测试依赖：

- `vitest`
- `@vitest/coverage-v8`
- `playwright`

可选依赖：

- `open` 或等价方案，后续如要从 daemon 弹浏览器页面时再加

## 6. Phase 1 功能边界

### 6.1 Filesystem Capability

Phase 1 只支持两个权限：

- `read`
- `watch`

只支持一个授权根目录：

```ts
type FilesystemGrant = {
  type: 'filesystem'
  rootPath: string
  permissions: Array<'read' | 'watch'>
}
```

不使用 `roots[]` 的原因：

- 当前客户端 API 只传相对路径
- 如果同时有多个 root，客户端无法稳定表达目标 root
- 先用单 root 降低协议复杂度

多 root 放到 Phase 2，再引入 `rootId`

### 6.2 身份模型

Phase 1 仍采用：

- `Origin`
- `clientId`

实际授权主键建议定义为：

```ts
type GrantKey = `${origin}::${clientId}`
```

原因：

- `clientId` 不是可信身份
- `Origin` 才是浏览器侧关键隔离边界
- 直接用组合键存储，比嵌套 JSON 更容易扩展

### 6.3 运行形态

Phase 1 daemon 为前台交互式进程：

- 用户手动启动
- 首次授权在终端完成
- 不做系统托盘
- 不做桌面弹窗

CLI 先支持：

- `local-connector start`
- `local-connector grants list`
- `local-connector grants revoke <origin> <clientId>`

其中：

- `start` 是必须项
- `grants list/revoke` 建议一并实现，便于调试和验收

## 7. 核心数据模型

### 7.1 GrantRecord

```ts
type GrantRecord = {
  id: string
  origin: string
  clientId: string
  productName: string
  capability: {
    type: 'filesystem'
    rootPath: string
    permissions: Array<'read' | 'watch'>
  }
  grantedAt: string
  updatedAt: string
}
```

### 7.2 Session

```ts
type Session = {
  id: string
  socket: WebSocket
  origin: string
  clientId: string
  productName: string
  state: 'connected' | 'pending_auth' | 'ready' | 'closed'
  grant: GrantRecord | null
  subscriptions: Map<string, WatchSubscription>
  lastSeenAt: number
}
```

### 7.3 WatchSubscription

```ts
type WatchSubscription = {
  id: string
  relativePath: string
  absPath: string
  close(): Promise<void>
}
```

## 8. 授权持久化

授权记录建议存到用户本地配置目录：

- macOS: `~/Library/Application Support/local-connector/grants.json`
- Linux: `~/.config/local-connector/grants.json`
- Windows: `%APPDATA%/local-connector/grants.json`

通过 `env-paths` 统一处理。

存储格式建议为数组，而不是对象 map：

```json
{
  "version": 1,
  "grants": [
    {
      "id": "grant_xxx",
      "origin": "https://review.company.com",
      "clientId": "product-a",
      "productName": "Code Review",
      "capability": {
        "type": "filesystem",
        "rootPath": "/Users/name/projects/demo",
        "permissions": ["read", "watch"]
      },
      "grantedAt": "2026-04-08T10:00:00.000Z",
      "updatedAt": "2026-04-08T10:00:00.000Z"
    }
  ]
}
```

收益：

- 后续扩展 capability 不需要改存储骨架
- 后续扩展多授权记录和撤销逻辑更方便

## 9. 通信协议

Phase 1 采用 JSON 文本协议，统一为请求、响应、事件三类消息。

### 9.1 基础结构

```ts
type RequestMessage = {
  id: string
  type: 'request'
  method: string
  params?: unknown
}

type SuccessResponseMessage = {
  id: string
  type: 'response'
  ok: true
  result: unknown
}

type ErrorResponseMessage = {
  id: string
  type: 'response'
  ok: false
  error: {
    code: string
    message: string
  }
}

type EventMessage = {
  type: 'event'
  event: string
  payload?: unknown
}
```

### 9.2 请求方法

Phase 1 只实现以下方法：

- `session.hello`
- `session.pong`
- `filesystem.readFile`
- `filesystem.readDir`
- `filesystem.watch`
- `filesystem.unwatch`

### 9.3 事件

Phase 1 只实现以下事件：

- `session.authPending`
- `session.ready`
- `session.ping`
- `filesystem.watchEvent`

### 9.4 方法参数

`session.hello`

```ts
{
  protocolVersion: 1,
  clientId: string,
  productName: string,
  requestedCapabilities: [
    {
      type: 'filesystem',
      permissions: Array<'read' | 'watch'>
    }
  ]
}
```

`filesystem.readFile`

```ts
{
  path: string
}
```

`filesystem.readDir`

```ts
{
  path: string
}
```

`filesystem.watch`

```ts
{
  path: string
  subscriptionId: string
}
```

`filesystem.unwatch`

```ts
{
  subscriptionId: string
}
```

### 9.5 结果结构

`filesystem.readFile`

```ts
{
  content: string
  encoding: 'utf-8'
  size: number
  mtimeMs: number
}
```

限制：

- Phase 1 只支持文本读取
- 超大文件要有大小上限，例如默认 2 MB

`filesystem.readDir`

```ts
Array<{
  name: string
  kind: 'file' | 'directory'
}>
```

`filesystem.watchEvent`

```ts
{
  subscriptionId: string
  kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
}
```

## 10. 连接生命周期

### 10.1 服务端行为

- 监听 `127.0.0.1:3999`
- 只接受 loopback 连接
- 从 WebSocket 握手头读取 `Origin`
- 建立基础 session
- 等待 `session.hello`
- 完成授权后切换到 `ready`
- 定时发送 `session.ping`
- 超时未收到 `session.pong` 则关闭连接

### 10.2 客户端行为

- 连接本地 WebSocket
- 建立后立即发送 `session.hello`
- 收到 `session.authPending` 时进入等待态
- 收到 `session.ready` 后开放 API
- 断线后指数退避重连
- 重连成功后重新发送 `session.hello`
- 已建立的 watch 订阅自动重建

### 10.3 重连策略

建议重连间隔：

- 250ms
- 500ms
- 1s
- 2s
- 5s

加入随机抖动，避免同时重连打满 daemon。

## 11. Gateway 设计

Gateway 负责：

- 校验连接来源
- 处理 `session.hello`
- 查询授权记录
- 判断是否需要审批
- 将 session 切到 `pending_auth` 或 `ready`
- 将业务请求路由给 Guard 和 Capability

处理规则：

1. 若无 `Origin`，直接拒绝
2. 若 `Origin` 不合法，直接拒绝
3. 若 `session.hello` 缺失或超时，关闭连接
4. 若无本地 grant，进入审批
5. 若请求权限超过现有 grant，进入审批
6. 若 grant 满足请求，则发 `session.ready`

权限协商规则：

- 只有 `read` 和 `watch`
- 若浏览器只请求 `read`，已存在 `read + watch` grant，则直接复用
- 若浏览器请求 `watch`，已有 grant 只有 `read`，则必须重新审批

## 12. 终端审批流

Phase 1 不做 GUI，审批全部在 daemon 终端中完成。

建议交互流程：

1. 打印请求来源：
   `https://review.company.com`
2. 打印 `clientId` 和 `productName`
3. 打印请求权限：
   `read, watch`
4. 用户输入是否允许：
   `y / n`
5. 如果允许，提示输入本地目录路径
6. 校验目录是否存在
7. 持久化 grant
8. 通知对应 session `ready`

最小实现可接受串行审批：

- 一次只处理一个 pending approval
- 后续如并发很多，再做队列和去重

## 13. Guard 设计

Guard 是 Phase 1 安全核心。

### 13.1 输入

- `Session`
- 操作类型
- 相对路径

### 13.2 规则

必须拒绝以下输入：

- 空路径
- 绝对路径
- 包含 `..` 的越界路径
- 包含空字节
- Windows 盘符前缀
- 非字符串类型

路径校验流程：

1. `normalize` 传入路径
2. 确保其仍为相对路径
3. 组合得到 `absPath = resolve(rootPath, relativePath)`
4. 校验 `absPath.startsWith(rootPathWithSep)`
5. 校验通过后才返回给执行层

### 13.3 Phase 1 明确保留的缺口

- 不做 `realpath` 检查
- 不处理 symlink escape
- 不做 Windows 大小写细节处理

这几项必须在文档和错误提示里明确说明，避免误判安全边界。

## 14. Filesystem Capability 设计

### 14.1 readFile

职责：

- 读取文本文件
- 返回内容和基础元信息

约束：

- 默认 UTF-8
- 超过大小限制直接拒绝
- 非文本文件直接返回错误

错误码建议：

- `ERR_FILE_NOT_FOUND`
- `ERR_FILE_TOO_LARGE`
- `ERR_FILE_NOT_TEXT`

### 14.2 readDir

职责：

- 返回一层目录项
- 只返回 `name` 和 `kind`

Phase 1 不返回：

- 权限位
- inode
- hash
- 深层递归结果

### 14.3 watch

实现建议：

- 基于 `chokidar`
- 每个 session 的每个订阅单独分配 `subscriptionId`
- 服务端把文件事件转成相对路径再发回客户端

Phase 1 约束：

- 不承诺事件不丢
- 不承诺严格顺序
- 不做断线补偿

## 15. 浏览器客户端 SDK 设计

建议外部 API：

```ts
const connector = new ConnectorClient({
  clientId: 'product-a',
  productName: 'Code Review',
  capabilities: [
    {
      type: 'filesystem',
      permissions: ['read', 'watch']
    }
  ]
})

await connector.connect()

const file = await connector.filesystem.readFile('src/main.ts')
const entries = await connector.filesystem.readDir('src')

for await (const event of connector.filesystem.watch('src')) {
  // ...
}
```

内部模块分工：

- `connection.ts`: WebSocket 建连和断连
- `rpc.ts`: 请求响应映射
- `reconnect.ts`: 重连退避
- `filesystem.ts`: 对外 API 封装

状态机建议：

- `idle`
- `connecting`
- `auth_pending`
- `ready`
- `reconnecting`
- `closed`

建议提供状态回调：

```ts
connector.onStatusChange((status) => {
  // update UI
})
```

## 16. 错误码

建议先固定一批稳定错误码，避免前后端对错误做字符串匹配：

- `ERR_UNAUTHORIZED_ORIGIN`
- `ERR_INVALID_HELLO`
- `ERR_AUTH_PENDING`
- `ERR_ACCESS_DENIED`
- `ERR_PATH_INVALID`
- `ERR_PATH_OUT_OF_ROOT`
- `ERR_UNSUPPORTED_OPERATION`
- `ERR_DAEMON_UNAVAILABLE`
- `ERR_FILE_NOT_FOUND`
- `ERR_FILE_TOO_LARGE`
- `ERR_FILE_NOT_TEXT`
- `ERR_INTERNAL`

## 17. 日志与可观测性

Phase 1 不需要重型监控，但至少要有结构化日志。

建议日志字段：

- `ts`
- `level`
- `sessionId`
- `origin`
- `clientId`
- `method`
- `status`
- `errorCode`

必须记录的事件：

- daemon 启动
- WebSocket 连接建立和关闭
- hello 处理结果
- 授权请求和授权结果
- 文件读取失败
- watch 建立和取消

## 18. 测试计划

### 18.1 单元测试

覆盖：

- 协议 schema 校验
- grant 查询逻辑
- 权限协商
- Guard 路径检查
- 错误码映射

### 18.2 集成测试

覆盖：

- WebSocket 建连
- `session.hello`
- 首次授权成功
- 首次授权拒绝
- 已授权复连
- 未授权目录访问拒绝
- 路径穿越拒绝
- `watch` 事件上报

### 18.3 E2E Smoke

准备一个最小浏览器页面：

- 展示连接状态
- 触发 `readFile`
- 触发 `readDir`
- 展示 `watch` 事件

验证环境：

- Chrome
- Firefox

Safari 只验证错误提示，不做通过要求。

## 19. 开发顺序

建议按以下顺序推进：

### Milestone 1: 工程骨架

- 初始化 `package.json`
- 初始化 TypeScript 和构建配置
- 确定 `exports`
- 搭好 `shared` 类型

产出：

- 包可构建
- 浏览器入口和 daemon 入口均可被解析

### Milestone 2: 最小连接闭环

- daemon 启动并监听 `127.0.0.1:3999`
- 浏览器可连接
- 完成 `session.hello`
- 实现基础请求响应协议

产出：

- 可从浏览器收到 `session.ready` 或 `session.authPending`

### Milestone 3: 授权与持久化

- grant store
- 终端审批流
- 权限升级逻辑
- `grants list` / `grants revoke`

产出：

- 可完成首次授权
- 已授权产品重连无需再次确认

### Milestone 4: Filesystem 读能力

- Guard 路径校验
- `readFile`
- `readDir`

产出：

- 已授权目录内的文件和目录可读取
- 越权路径被拒绝

### Milestone 5: Watch 能力

- `watch`
- `unwatch`
- 订阅生命周期管理
- 客户端自动重订阅

产出：

- 本地文件变化可传回浏览器

### Milestone 6: 验收与收尾

- smoke page
- 集成测试
- 文档补齐
- 错误提示优化

产出：

- Phase 1 可演示和可验收

## 20. 验收标准

必须满足：

- Web 页面可连接本机 daemon
- 未授权产品无法直接访问文件系统
- 首次授权后可读取 root 下文本文件
- 首次授权后可读取 root 下一层目录
- 首次授权后可监听 root 下目录变化
- 路径穿越请求被拒绝
- daemon 重启后客户端可自动重连
- 已授权产品重连后可恢复读取能力

允许暂时不满足：

- Safari 可用
- symlink 安全
- Windows 全量兼容
- 断线期间事件补偿

## 21. 风险与待确认项

需要尽早确认的点：

1. Phase 1 是否允许二进制文件读取  
   当前建议：不允许，只支持文本文件。

2. 浏览器侧是否要暴露 daemon 未启动的专用状态  
   当前建议：要，便于前端提示用户启动本地进程。

3. 是否需要同时支持本地开发页面 `http://localhost:*` 和线上页面 `https://*.company.com`  
   当前建议：要，但分别授权，不能混用。

4. `productName` 是否可信  
   当前建议：不可信，只作为展示字段，不参与安全判断。

5. 默认端口是否固定为 `3999`  
   当前建议：Phase 1 固定端口，后续如冲突再扩展探测。

## 22. 推荐下一步

按当前计划，最合理的下一步是：

1. 初始化单 package 工程骨架
2. 写 `package.json` 的 `exports`
3. 实现 `shared/protocol.ts`
4. 先打通 `session.hello -> authPending/ready` 闭环
5. 再接 `readFile/readDir`

如果要进一步压缩范围，可以先只做：

- `readFile`
- `readDir`

把 `watch` 放到 Milestone 5 单独完成。
