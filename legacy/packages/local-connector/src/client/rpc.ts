import { ERROR_CODES, LocalConnectorError, type ErrorCode } from '../shared/errors'
import { createRequest, decodeMessage, encodeMessage } from '../shared/protocol'
import type { EventMessage, RequestMessage, ResponseMessage } from '../shared/types'

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: unknown): void
}

type EventHandler = (payload: unknown) => void

export class RpcClient {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventHandlers = new Map<EventMessage['event'], Set<EventHandler>>()

  constructor(private readonly sendRaw: (raw: string) => void) {}

  request<T>(method: RequestMessage['method'], params?: unknown): Promise<T> {
    const id = crypto.randomUUID()
    const message = createRequest(id, method, params)

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })

      try {
        this.sendRaw(encodeMessage(message))
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  handleIncoming(raw: string): void {
    const message = decodeMessage(raw)

    if (message.type === 'response') {
      this.handleResponse(message)
      return
    }

    if (message.type === 'event') {
      const handlers = this.eventHandlers.get(message.event)
      if (!handlers) {
        return
      }

      for (const handler of handlers) {
        handler(message.payload)
      }
    }
  }

  failPending(reason?: string): void {
    const error = new LocalConnectorError(
      ERROR_CODES.daemonUnavailable,
      reason ?? 'Local connector disconnected unexpectedly'
    )

    for (const pending of this.pending.values()) {
      pending.reject(error)
    }

    this.pending.clear()
  }

  onEvent(event: EventMessage['event'], handler: EventHandler): () => void {
    const existing = this.eventHandlers.get(event) ?? new Set<EventHandler>()
    existing.add(handler)
    this.eventHandlers.set(event, existing)

    return () => {
      const handlers = this.eventHandlers.get(event)
      if (!handlers) {
        return
      }

      handlers.delete(handler)
      if (handlers.size === 0) {
        this.eventHandlers.delete(event)
      }
    }
  }

  private handleResponse(message: ResponseMessage): void {
    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }

    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.result)
      return
    }

    pending.reject(new LocalConnectorError(message.error.code as ErrorCode, message.error.message))
  }
}
