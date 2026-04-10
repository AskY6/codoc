import WebSocket from 'ws'

import { createErrorResponse, createEvent, createSuccessResponse } from '../shared/protocol'
import {
  parseGrantsRevokeParams,
  parseHelloParams,
  parseReadDirParams,
  parseReadFileParams,
  parseUnwatchParams,
  parseWatchParams
} from '../shared/schema'
import { DEFAULT_HOST, DEFAULT_PORT, PROTOCOL_VERSION, type FilesystemPermission, type HelloResult, type RequestMessage } from '../shared/types'
import { ERROR_CODES, LocalConnectorError, toErrorPayload } from '../shared/errors'
import type { ApprovalManager } from './approval'
import { GrantStore } from './grants'
import { Guard } from './guard'
import { FilesystemCapability } from './filesystem'
import type { Session } from './session'
import { WatchManager } from './watch'

type GatewayDependencies = {
  grants: GrantStore
  approval: ApprovalManager
  guard: Guard
  filesystem: FilesystemCapability
  watch: WatchManager
}

function uniquePermissions(permissions: FilesystemPermission[]): FilesystemPermission[] {
  return [...new Set(permissions)]
}

export class Gateway {
  constructor(private readonly deps: GatewayDependencies) {}

  async handleRequest(session: Session, message: RequestMessage): Promise<void> {
    session.lastSeenAt = Date.now()

    try {
      switch (message.method) {
        case 'session.hello':
          await this.handleHello(session, message)
          return
        case 'session.pong':
          session.lastSeenAt = Date.now()
          this.safeSend(session, createSuccessResponse(message.id, { ok: true }))
          return
        case 'filesystem.readFile':
          await this.handleReadFile(session, message)
          return
        case 'filesystem.readDir':
          await this.handleReadDir(session, message)
          return
        case 'filesystem.watch':
          await this.handleWatch(session, message)
          return
        case 'filesystem.unwatch':
          await this.handleUnwatch(session, message)
          return
        case 'grants.list':
          await this.handleGrantsList(session, message)
          return
        case 'grants.revoke':
          await this.handleGrantsRevoke(session, message)
          return
        default:
          throw new LocalConnectorError(ERROR_CODES.unsupportedOperation, `Unsupported method: ${message.method}`)
      }
    } catch (error) {
      this.safeSend(session, createErrorResponse(message.id, toErrorPayload(error)))
    }
  }

  async closeSession(session: Session): Promise<void> {
    for (const subscription of session.subscriptions.values()) {
      await subscription.close()
    }

    session.subscriptions.clear()
    session.state = 'closed'
  }

  private async handleHello(session: Session, message: RequestMessage): Promise<void> {
    const params = parseHelloParams(message.params)
    if (params.protocolVersion !== PROTOCOL_VERSION) {
      throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Protocol version mismatch')
    }

    const filesystemRequest = params.requestedCapabilities.find((capability) => capability.type === 'filesystem')
    if (!filesystemRequest) {
      throw new LocalConnectorError(ERROR_CODES.invalidHello, 'filesystem capability is required in Phase 1')
    }

    session.helloReceived = true
    session.clientId = params.clientId
    session.productName = params.productName

    const existingGrant = await this.deps.grants.find(session.origin, params.clientId)
    const requestedPermissions = uniquePermissions(filesystemRequest.permissions)

    // Auto-approve sessions from the daemon's own admin page
    const adminOrigin = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`
    const isAdminOrigin = session.origin === adminOrigin

    const needsApproval =
      !isAdminOrigin &&
      (!existingGrant ||
        requestedPermissions.some((permission) => !existingGrant.capability.permissions.includes(permission)))

    if (needsApproval) {
      session.state = 'pending_auth'
      this.safeSend(session, createEvent('session.authPending', { sessionId: session.id }))

      const approval = await this.deps.approval.request({
        origin: session.origin,
        clientId: params.clientId,
        productName: params.productName,
        permissions: requestedPermissions,
        existingGrant
      })

      if (!approval.approved || !approval.rootPath) {
        throw new LocalConnectorError(ERROR_CODES.accessDenied, 'Local access request was denied')
      }

      this.assertSessionAlive(session)

      session.grant = await this.deps.grants.upsert({
        origin: session.origin,
        clientId: params.clientId,
        productName: params.productName,
        rootPath: approval.rootPath,
        permissions: existingGrant
          ? uniquePermissions([...existingGrant.capability.permissions, ...requestedPermissions])
          : requestedPermissions
      })

      session.state = 'ready'
      const result: HelloResult = {
        sessionId: session.id,
        state: 'ready',
        grantedCapabilities: [session.grant.capability]
      }

      this.safeSend(session, createSuccessResponse(message.id, result))
      this.safeSend(
        session,
        createEvent('session.ready', {
          sessionId: session.id,
          grantedCapabilities: [session.grant.capability]
        })
      )
      return
    }

    session.grant = existingGrant ?? null
    session.state = 'ready'

    if (!session.grant && !isAdminOrigin) {
      throw new LocalConnectorError(ERROR_CODES.accessDenied, 'Missing stored grant for ready session')
    }

    const grantedCapabilities = session.grant ? [session.grant.capability] : []
    const result: HelloResult = {
      sessionId: session.id,
      state: 'ready',
      grantedCapabilities
    }

    this.safeSend(session, createSuccessResponse(message.id, result))
  }

  private async handleReadFile(session: Session, message: RequestMessage): Promise<void> {
    const params = parseReadFileParams(message.params)
    const absPath = this.deps.guard.checkFilesystemAccess(session, params.path, 'read')
    const result = await this.deps.filesystem.readTextFile(absPath)
    this.safeSend(session, createSuccessResponse(message.id, result))
  }

  private async handleReadDir(session: Session, message: RequestMessage): Promise<void> {
    const params = parseReadDirParams(message.params)
    const absPath = this.deps.guard.checkFilesystemAccess(session, params.path, 'read')
    const result = await this.deps.filesystem.readDirectory(absPath)
    this.safeSend(session, createSuccessResponse(message.id, result))
  }

  private async handleWatch(session: Session, message: RequestMessage): Promise<void> {
    const params = parseWatchParams(message.params)
    const absPath = this.deps.guard.checkFilesystemAccess(session, params.path, 'watch')

    if (!session.grant) {
      throw new LocalConnectorError(ERROR_CODES.accessDenied, 'No grant available for watch')
    }

    const existing = session.subscriptions.get(params.subscriptionId)
    if (existing) {
      await existing.close()
      session.subscriptions.delete(params.subscriptionId)
    }

    const registration = this.deps.watch.subscribe({
      subscriptionId: params.subscriptionId,
      absPath,
      rootPath: session.grant.capability.rootPath,
      onEvent: (payload) => {
        this.safeSend(session, createEvent('filesystem.watchEvent', payload))
      }
    })

    session.subscriptions.set(params.subscriptionId, {
      id: params.subscriptionId,
      relativePath: params.path,
      absPath,
      close: registration.close
    })

    this.safeSend(
      session,
      createSuccessResponse(message.id, {
        subscriptionId: params.subscriptionId
      })
    )
  }

  private async handleUnwatch(session: Session, message: RequestMessage): Promise<void> {
    const params = parseUnwatchParams(message.params)
    const existing = session.subscriptions.get(params.subscriptionId)

    if (existing) {
      await existing.close()
      session.subscriptions.delete(params.subscriptionId)
    }

    this.safeSend(session, createSuccessResponse(message.id, { subscriptionId: params.subscriptionId }))
  }

  private async handleGrantsList(session: Session, message: RequestMessage): Promise<void> {
    if (!session.helloReceived) {
      throw new LocalConnectorError(ERROR_CODES.accessDenied, 'Session must complete hello to list grants')
    }
    const grants = await this.deps.grants.list()
    this.safeSend(session, createSuccessResponse(message.id, { grants }))
  }

  private async handleGrantsRevoke(session: Session, message: RequestMessage): Promise<void> {
    if (!session.helloReceived) {
      throw new LocalConnectorError(ERROR_CODES.accessDenied, 'Session must complete hello to revoke grants')
    }
    const params = parseGrantsRevokeParams(message.params)
    const revoked = await this.deps.grants.revoke(params.origin, params.clientId)
    this.safeSend(session, createSuccessResponse(message.id, { revoked }))
  }

  private assertSessionAlive(session: Session): void {
    if (session.state === 'closed' || session.socket.readyState !== WebSocket.OPEN) {
      throw new LocalConnectorError(
        ERROR_CODES.daemonUnavailable,
        'Client disconnected before the approval flow completed'
      )
    }
  }

  private safeSend(session: Session, message: unknown): void {
    if (session.socket.readyState !== WebSocket.OPEN) {
      return
    }

    session.socket.send(JSON.stringify(message))
  }
}
