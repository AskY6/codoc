import { parseIncomingMessage } from './schema'
import type { EventMessage, Message, RequestMessage, ResponseMessage } from './types'

export function encodeMessage(message: Message): string {
  return JSON.stringify(message)
}

export function decodeMessage(raw: string): Message {
  return parseIncomingMessage(raw)
}

export function createRequest<TParams>(id: string, method: RequestMessage['method'], params?: TParams): RequestMessage {
  return {
    id,
    type: 'request',
    method,
    params
  }
}

export function createSuccessResponse(id: string, result: unknown): ResponseMessage {
  return {
    id,
    type: 'response',
    ok: true,
    result
  }
}

export function createErrorResponse(id: string, error: { code: string; message: string }): ResponseMessage {
  return {
    id,
    type: 'response',
    ok: false,
    error
  }
}

export function createEvent(event: EventMessage['event'], payload?: unknown): EventMessage {
  return {
    type: 'event',
    event,
    payload
  }
}
