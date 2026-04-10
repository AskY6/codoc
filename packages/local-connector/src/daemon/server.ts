import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import WebSocket, { WebSocketServer, type RawData } from 'ws'

import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_HELLO_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_PORT
} from '../shared/types'
import { decodeMessage } from '../shared/protocol'
import { ERROR_CODES, LocalConnectorError, toErrorPayload } from '../shared/errors'
import { ApprovalManager } from './approval'
import { FilesystemCapability } from './filesystem'
import { Gateway } from './gateway'
import { GrantStore } from './grants'
import { Guard } from './guard'
import { HeartbeatManager } from './heartbeat'
import { createSession, type Session } from './session'
import { WatchManager } from './watch'
import { adminPageHtml } from './admin-page'

export type LocalConnectorServerOptions = {
  host?: string
  port?: number
}

export class LocalConnectorServer {
  readonly sessions = new Map<string, Session>()
  readonly grants: GrantStore

  private wss: WebSocketServer | null = null
  private httpServer: ReturnType<typeof createServer> | null = null
  private readonly gateway: Gateway
  private readonly heartbeat: HeartbeatManager
  private startPromise: Promise<void> | null = null

  constructor(private readonly options: LocalConnectorServerOptions = {}) {
    this.grants = new GrantStore()

    this.gateway = new Gateway({
      grants: this.grants,
      approval: new ApprovalManager(),
      guard: new Guard(),
      filesystem: new FilesystemCapability(),
      watch: new WatchManager()
    })

    this.heartbeat = new HeartbeatManager(
      this.sessions,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_TIMEOUT_MS
    )
  }

  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }

    if (this.wss) {
      return Promise.resolve()
    }

    this.startPromise = new Promise<void>((resolve, reject) => {
      const host = this.options.host ?? DEFAULT_HOST
      const port = this.options.port ?? DEFAULT_PORT

      const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'GET' && (req.url === '/' || req.url === '/admin')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(adminPageHtml())
          return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      })

      const wss = new WebSocketServer({ server: httpServer })

      this.httpServer = httpServer
      this.wss = wss

      const handleStartupError = (error: Error) => {
        this.wss = null
        this.httpServer = null
        this.startPromise = null
        reject(error)
      }

      httpServer.once('error', handleStartupError)

      wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
        const origin = request.headers.origin

        if (typeof origin !== 'string' || origin.trim() === '') {
          socket.send(
            JSON.stringify({
              id: randomUUID(),
              type: 'response',
              ok: false,
              error: {
                code: ERROR_CODES.unauthorizedOrigin,
                message: 'Missing or invalid Origin header'
              }
            })
          )
          socket.close(4401, 'Unauthorized origin')
          return
        }

        const session = createSession(randomUUID(), socket, origin)
        this.sessions.set(session.id, session)

        const helloTimer = setTimeout(() => {
          if (!session.helloReceived && socket.readyState === WebSocket.OPEN) {
            socket.close(4408, 'session.hello timeout')
          }
        }, DEFAULT_HELLO_TIMEOUT_MS)

        socket.on('message', async (data: RawData, isBinary: boolean) => {
          if (isBinary) {
            socket.close(4400, 'Binary messages are not supported')
            return
          }

          try {
            const message = decodeMessage(data.toString())

            if (message.type !== 'request') {
              throw new LocalConnectorError(ERROR_CODES.invalidHello, 'Daemon only accepts request messages')
            }

            await this.gateway.handleRequest(session, message)
          } catch (error) {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  id: randomUUID(),
                  type: 'response',
                  ok: false,
                  error: toErrorPayload(error)
                })
              )
            }
          }
        })

        socket.on('close', async () => {
          clearTimeout(helloTimer)
          await this.gateway.closeSession(session)
          this.sessions.delete(session.id)
        })

        socket.on('error', () => {
          clearTimeout(helloTimer)
        })
      })

      httpServer.listen(port, host, () => {
        httpServer.off('error', handleStartupError)
        httpServer.on('error', (error) => {
          console.error(`Local Connector server error: ${error.message}`)
        })

        this.heartbeat.start()
        console.log(`Local Connector listening on ws://${host}:${port}`)
        console.log(`Admin page: http://${host}:${port}/`)

        resolve()
      })
    })

    return this.startPromise
  }

  async stop(): Promise<void> {
    const wss = this.wss
    const httpServer = this.httpServer
    if (!wss || !httpServer) {
      return
    }

    this.heartbeat.stop()

    for (const session of this.sessions.values()) {
      await this.gateway.closeSession(session)
      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.close(1001, 'Server shutting down')
      }
    }

    this.sessions.clear()
    this.wss = null
    this.httpServer = null
    this.startPromise = null

    await new Promise<void>((resolve, reject) => {
      wss.close(() => {
        httpServer.close((error?: Error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    })
  }
}

export function createLocalConnectorServer(options?: LocalConnectorServerOptions): LocalConnectorServer {
  return new LocalConnectorServer(options)
}
