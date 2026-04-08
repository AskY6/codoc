import { LocalConnectorError, ERROR_CODES } from './errors'
import type {
  EventMessage,
  FilesystemPermission,
  HelloParams,
  Message,
  ReadDirParams,
  ReadFileParams,
  RequestMessage,
  ResponseMessage,
  UnwatchParams,
  WatchEventPayload,
  WatchParams
} from './types'

const PHASE1_FILESYSTEM_PERMISSIONS: ReadonlySet<FilesystemPermission> = new Set(['read', 'watch'])

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalConnectorError(ERROR_CODES.invalidHello, message)
  }

  return value as Record<string, unknown>
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LocalConnectorError(ERROR_CODES.invalidHello, message)
  }

  return value
}

export function parseIncomingMessage(raw: string): Message {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Invalid JSON message')
  }

  const record = assertRecord(parsed, 'Invalid message payload')
  const type = assertString(record.type, 'Missing message type')

  if (type === 'request') {
    assertString(record.id, 'Missing request id')
    assertString(record.method, 'Missing request method')
    return record as unknown as RequestMessage
  }

  if (type === 'response') {
    assertString(record.id, 'Missing response id')
    return record as unknown as ResponseMessage
  }

  if (type === 'event') {
    assertString(record.event, 'Missing event name')
    return record as unknown as EventMessage
  }

  throw new LocalConnectorError(ERROR_CODES.invalidHello, `Unknown message type: ${type}`)
}

export function parseHelloParams(value: unknown): HelloParams {
  const record = assertRecord(value, 'Invalid hello params')
  const requestedCapabilities = record.requestedCapabilities

  if (!Array.isArray(requestedCapabilities)) {
    throw new LocalConnectorError(ERROR_CODES.invalidHello, 'requestedCapabilities must be an array')
  }

  const clientId = assertString(record.clientId, 'Missing clientId')
  const productName = assertString(record.productName, 'Missing productName')
  const protocolVersion = Number(record.protocolVersion)

  if (!Number.isInteger(protocolVersion) || protocolVersion < 1) {
    throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Invalid protocolVersion')
  }

  for (const capability of requestedCapabilities) {
    const capabilityRecord = assertRecord(capability, 'Invalid capability request')

    if (capabilityRecord.type !== 'filesystem') {
      throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Unsupported capability type')
    }

    if (!Array.isArray(capabilityRecord.permissions)) {
      throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Capability permissions must be an array')
    }

    if (capabilityRecord.permissions.length === 0) {
      throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Capability permissions must not be empty')
    }

    for (const permission of capabilityRecord.permissions) {
      if (typeof permission !== 'string' || !PHASE1_FILESYSTEM_PERMISSIONS.has(permission as FilesystemPermission)) {
        throw new LocalConnectorError(
          ERROR_CODES.invalidHello,
          `Unsupported filesystem permission: ${String(permission)}`
        )
      }
    }
  }

  return {
    protocolVersion,
    clientId,
    productName,
    requestedCapabilities: requestedCapabilities as HelloParams['requestedCapabilities']
  }
}

export function parseReadFileParams(value: unknown): ReadFileParams {
  const record = assertRecord(value, 'Invalid readFile params')
  return { path: assertString(record.path, 'Missing path') }
}

export function parseReadDirParams(value: unknown): ReadDirParams {
  const record = assertRecord(value, 'Invalid readDir params')
  return { path: assertString(record.path, 'Missing path') }
}

export function parseWatchParams(value: unknown): WatchParams {
  const record = assertRecord(value, 'Invalid watch params')
  return {
    path: assertString(record.path, 'Missing path'),
    subscriptionId: assertString(record.subscriptionId, 'Missing subscriptionId')
  }
}

export function parseUnwatchParams(value: unknown): UnwatchParams {
  const record = assertRecord(value, 'Invalid unwatch params')
  return { subscriptionId: assertString(record.subscriptionId, 'Missing subscriptionId') }
}

export function parseWatchEventPayload(value: unknown): WatchEventPayload {
  const record = assertRecord(value, 'Invalid watch event payload')
  return {
    subscriptionId: assertString(record.subscriptionId, 'Missing subscriptionId'),
    kind: assertString(record.kind, 'Missing event kind') as WatchEventPayload['kind'],
    path: assertString(record.path, 'Missing event path')
  }
}
