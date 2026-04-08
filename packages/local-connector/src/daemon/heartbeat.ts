import WebSocket from 'ws'

import { createEvent } from '../shared/protocol'
import type { Session } from './session'

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly sessions: Map<string, Session>,
    private readonly intervalMs: number,
    private readonly timeoutMs: number
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      const now = Date.now()

      for (const session of this.sessions.values()) {
        if (session.socket.readyState !== WebSocket.OPEN) {
          continue
        }

        if (now - session.lastSeenAt > this.timeoutMs) {
          session.socket.close(4000, 'Heartbeat timeout')
          continue
        }

        session.socket.send(JSON.stringify(createEvent('session.ping', { ts: now })))
      }
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
