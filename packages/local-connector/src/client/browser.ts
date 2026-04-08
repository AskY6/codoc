import { DEFAULT_HOST, DEFAULT_PORT, PROTOCOL_VERSION, type ConnectorClientOptions, type ConnectorStatus, type HelloResult, type SessionReadyPayload } from '../shared/types'
import { ERROR_CODES, LocalConnectorError } from '../shared/errors'
import { BrowserConnection } from './connection'
import { createWatchQueue, FilesystemClient, type WatchStream } from './filesystem'
import { ReconnectBackoff } from './reconnect'
import { RpcClient } from './rpc'

type StatusListener = (status: ConnectorStatus) => void

type ActiveSubscription = {
  id: string
  path: string
  enqueue(payload: unknown): void
  fail(error: unknown): void
  close(): Promise<void>
}

function createDefaultUrl(): string {
  return `ws://${DEFAULT_HOST}:${DEFAULT_PORT}`
}

function shouldStopReconnect(error: unknown): boolean {
  return (
    error instanceof LocalConnectorError &&
    (error.code === ERROR_CODES.accessDenied ||
      error.code === ERROR_CODES.invalidHello ||
      error.code === ERROR_CODES.unauthorizedOrigin)
  )
}

function shouldKeepWatchPending(error: unknown): boolean {
  return error instanceof LocalConnectorError && error.code === ERROR_CODES.daemonUnavailable
}

export class ConnectorClient {
  readonly filesystem: FilesystemClient

  private readonly connection: BrowserConnection
  private readonly rpc: RpcClient
  private readonly reconnectBackoff = new ReconnectBackoff()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly activeSubscriptions = new Map<string, ActiveSubscription>()

  private connectPromise: Promise<void> | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((error: unknown) => void) | null = null
  private reconnectTimer: number | null = null
  private shouldReconnect = false
  private intentionallyClosed = false
  private hasConnectedOnce = false
  private status: ConnectorStatus = 'idle'

  constructor(private readonly options: ConnectorClientOptions) {
    if (options.capabilities.length === 0) {
      throw new LocalConnectorError(ERROR_CODES.invalidHello, 'At least one capability must be requested')
    }

    this.rpc = new RpcClient((raw) => {
      this.connection.send(raw)
    })

    this.connection = new BrowserConnection(options.url ?? createDefaultUrl(), {
      onOpen: () => {
        void this.handleOpen()
      },
      onMessage: (raw) => {
        this.rpc.handleIncoming(raw)
      },
      onClose: () => {
        this.handleClose()
      },
      onError: () => {
        // The close event drives reconnect logic.
      }
    })

    this.rpc.onEvent('session.authPending', () => {
      this.setStatus('auth_pending')
    })

    this.rpc.onEvent('session.ready', (payload) => {
      this.handleReady(payload as SessionReadyPayload)
    })

    this.rpc.onEvent('session.ping', () => {
      void this.rpc.request('session.pong')
    })

    this.rpc.onEvent('filesystem.watchEvent', (payload) => {
      const parsed = payload as { subscriptionId?: string }
      const subscriptionId = parsed.subscriptionId

      if (!subscriptionId) {
        return
      }

      this.activeSubscriptions.get(subscriptionId)?.enqueue(payload)
    })

    this.filesystem = new FilesystemClient(this.rpc, (path) => this.createWatchStream(path))
  }

  connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }

    this.shouldReconnect = true
    this.intentionallyClosed = false

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this.setStatus('connecting')
      this.connection.connect()
    })

    return this.connectPromise
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.intentionallyClosed = true

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    for (const subscription of this.activeSubscriptions.values()) {
      void subscription.close()
    }

    this.activeSubscriptions.clear()
    this.connectReject?.(new LocalConnectorError(ERROR_CODES.daemonUnavailable, 'Local connector disconnected'))
    this.connection.disconnect()
    this.rpc.failPending('Local connector disconnected')
    this.resetConnectPromise()
    this.setStatus('closed')
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this.status)

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private async handleOpen(): Promise<void> {
    try {
      const result = await this.rpc.request<HelloResult>('session.hello', {
        protocolVersion: PROTOCOL_VERSION,
        clientId: this.options.clientId,
        productName: this.options.productName,
        requestedCapabilities: this.options.capabilities
      })

      if (result.state === 'ready') {
        this.handleReady({
          sessionId: result.sessionId,
          grantedCapabilities: result.grantedCapabilities ?? []
        })
      }
    } catch (error) {
      if (shouldStopReconnect(error)) {
        this.shouldReconnect = false
      }

      if (!this.hasConnectedOnce) {
        this.connectReject?.(error)
        this.resetConnectPromise()
      }
      this.connection.disconnect(1011, 'hello failed')
    }
  }

  private handleReady(_payload: SessionReadyPayload): void {
    if (this.status === 'ready' && !this.connectResolve) {
      return
    }

    this.hasConnectedOnce = true
    this.reconnectBackoff.reset()
    this.setStatus('ready')

    const resolve = this.connectResolve
    this.resetConnectPromise()
    resolve?.()

    void this.resubscribeActiveWatches()
  }

  private handleClose(): void {
    this.rpc.failPending('Local connector connection closed')

    if (this.intentionallyClosed) {
      return
    }

    if (!this.shouldReconnect) {
      this.setStatus('closed')
      this.resetConnectPromise()
      return
    }

    this.setStatus('reconnecting')
    const delay = this.reconnectBackoff.nextDelayMs()
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connection.connect()
    }, delay)
  }

  private createWatchStream(path: string): WatchStream {
    const subscriptionId = crypto.randomUUID()
    const queue = createWatchQueue(subscriptionId, async (id) => {
      this.activeSubscriptions.delete(id)

      if (this.status === 'ready') {
        await this.rpc.request('filesystem.unwatch', { subscriptionId: id })
      }
    })

    const subscription: ActiveSubscription = {
      id: subscriptionId,
      path,
      enqueue: queue.enqueue,
      fail: queue.fail,
      close: queue.stream.close
    }

    this.activeSubscriptions.set(subscriptionId, subscription)

    if (this.status === 'ready') {
      void this.ensureWatchStarted(subscription)
    }

    return queue.stream
  }

  private async resubscribeActiveWatches(): Promise<void> {
    if (this.status !== 'ready') {
      return
    }

    for (const subscription of this.activeSubscriptions.values()) {
      try {
        await this.ensureWatchStarted(subscription)
      } catch {
        // The next reconnect will retry the subscription.
      }
    }
  }

  private async ensureWatchStarted(subscription: ActiveSubscription): Promise<void> {
    try {
      await this.rpc.request('filesystem.watch', {
        path: subscription.path,
        subscriptionId: subscription.id
      })
    } catch (error) {
      if (shouldKeepWatchPending(error)) {
        return
      }

      this.activeSubscriptions.delete(subscription.id)
      subscription.fail(error)
      throw error
    }
  }

  private setStatus(status: ConnectorStatus): void {
    this.status = status

    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  private resetConnectPromise(): void {
    this.connectPromise = null
    this.connectResolve = null
    this.connectReject = null
  }
}

export type {
  ConnectorClientOptions,
  ConnectorStatus
} from '../shared/types'
export type { WatchStream } from './filesystem'
