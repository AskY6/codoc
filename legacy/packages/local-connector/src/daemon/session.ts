import type WebSocket from 'ws'

import type { GrantRecord, SessionState } from '../shared/types'

export type WatchSubscription = {
  id: string
  relativePath: string
  absPath: string
  close(): Promise<void>
}

export type Session = {
  id: string
  socket: WebSocket
  origin: string
  clientId: string | null
  productName: string | null
  state: SessionState
  grant: GrantRecord | null
  subscriptions: Map<string, WatchSubscription>
  lastSeenAt: number
  helloReceived: boolean
}

export function createSession(id: string, socket: WebSocket, origin: string): Session {
  return {
    id,
    socket,
    origin,
    clientId: null,
    productName: null,
    state: 'connected',
    grant: null,
    subscriptions: new Map(),
    lastSeenAt: Date.now(),
    helloReceived: false
  }
}
