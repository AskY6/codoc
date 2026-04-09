export const PROTOCOL_VERSION = 1
export const DEFAULT_PORT = 3999
export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000
export const DEFAULT_HELLO_TIMEOUT_MS = 10_000

export type FilesystemPermission = 'read' | 'watch'
export type CapabilityType = 'filesystem'
export type ConnectorStatus =
  | 'idle'
  | 'connecting'
  | 'auth_pending'
  | 'ready'
  | 'reconnecting'
  | 'closed'

export type SessionState = 'connected' | 'pending_auth' | 'ready' | 'closed'

export type FilesystemCapabilityRequest = {
  type: 'filesystem'
  permissions: FilesystemPermission[]
}

export type FilesystemGrant = {
  type: 'filesystem'
  rootPath: string
  permissions: FilesystemPermission[]
}

export type GrantRecord = {
  id: string
  origin: string
  clientId: string
  productName: string
  capability: FilesystemGrant
  grantedAt: string
  updatedAt: string
}

export type GrantFile = {
  version: 1
  grants: GrantRecord[]
}

export type RequestMessage = {
  id: string
  type: 'request'
  method:
    | 'session.hello'
    | 'session.pong'
    | 'filesystem.readFile'
    | 'filesystem.readDir'
    | 'filesystem.watch'
    | 'filesystem.unwatch'
    | 'grants.list'
    | 'grants.revoke'
  params?: unknown
}

export type GrantsRevokeParams = {
  origin: string
  clientId: string
}

export type SuccessResponseMessage = {
  id: string
  type: 'response'
  ok: true
  result: unknown
}

export type ErrorResponseMessage = {
  id: string
  type: 'response'
  ok: false
  error: {
    code: string
    message: string
  }
}

export type ResponseMessage = SuccessResponseMessage | ErrorResponseMessage

export type EventMessage = {
  type: 'event'
  event:
    | 'session.authPending'
    | 'session.ready'
    | 'session.ping'
    | 'filesystem.watchEvent'
  payload?: unknown
}

export type Message = RequestMessage | ResponseMessage | EventMessage

export type HelloParams = {
  protocolVersion: number
  clientId: string
  productName: string
  requestedCapabilities: FilesystemCapabilityRequest[]
}

export type HelloResult = {
  sessionId: string
  state: 'auth_pending' | 'ready'
  grantedCapabilities?: FilesystemGrant[]
}

export type SessionReadyPayload = {
  sessionId: string
  grantedCapabilities: FilesystemGrant[]
}

export type SessionAuthPendingPayload = {
  sessionId: string
}

export type ReadFileParams = {
  path: string
}

export type ReadFileResult = {
  content: string
  encoding: 'utf-8'
  size: number
  mtimeMs: number
}

export type ReadDirParams = {
  path: string
}

export type ReadDirEntry = {
  name: string
  kind: 'file' | 'directory'
}

export type WatchParams = {
  path: string
  subscriptionId: string
}

export type UnwatchParams = {
  subscriptionId: string
}

export type WatchAck = {
  subscriptionId: string
}

export type WatchEventPayload = {
  subscriptionId: string
  kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
}

export type ConnectorClientOptions = {
  clientId: string
  productName: string
  capabilities: FilesystemCapabilityRequest[]
  url?: string
}
