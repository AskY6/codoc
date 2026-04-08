import { ERROR_CODES, LocalConnectorError } from '../shared/errors'

type BrowserConnectionHandlers = {
  onOpen(): void
  onMessage(raw: string): void
  onClose(event: CloseEvent): void
  onError(event: Event): void
}

export class BrowserConnection {
  private socket: WebSocket | null = null

  constructor(
    private readonly url: string,
    private readonly handlers: BrowserConnectionHandlers
  ) {}

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      return
    }

    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return
      }

      this.handlers.onOpen()
    })

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        return
      }

      this.handlers.onMessage(event.data)
    })

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) {
        this.socket = null
      }

      this.handlers.onClose(event)
    })

    socket.addEventListener('error', (event) => {
      this.handlers.onError(event)
    })
  }

  disconnect(code = 1000, reason = 'Client disconnect'): void {
    const socket = this.socket
    this.socket = null

    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close(code, reason)
    }
  }

  send(raw: string): void {
    const socket = this.socket

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new LocalConnectorError(ERROR_CODES.daemonUnavailable, 'Local connector is not connected')
    }

    socket.send(raw)
  }

  get readyState(): number {
    return this.socket?.readyState ?? WebSocket.CLOSED
  }
}
