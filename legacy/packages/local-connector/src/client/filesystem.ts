import type {
  ReadDirEntry,
  ReadFileResult,
  WatchEventPayload
} from '../shared/types'
import { parseWatchEventPayload } from '../shared/schema'
import { RpcClient } from './rpc'

type QueueWaiter<T> = {
  resolve(result: IteratorResult<T>): void
  reject(error: unknown): void
}

class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly values: T[] = []
  private readonly waiters: QueueWaiter<T>[] = []
  private done = false
  private error: unknown = null

  push(value: T): void {
    if (this.done) {
      return
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }

    this.values.push(value)
  }

  fail(error: unknown): void {
    if (this.done) {
      return
    }

    this.done = true
    this.error = error

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.reject(error)
    }
  }

  close(): void {
    if (this.done) {
      return
    }

    this.done = true

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.resolve({ value: undefined, done: true })
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.error) {
      return Promise.reject(this.error)
    }

    if (this.values.length > 0) {
      const value = this.values.shift() as T
      return Promise.resolve({ value, done: false })
    }

    if (this.done) {
      return Promise.resolve({ value: undefined, done: true })
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}

export type WatchStream = AsyncIterable<WatchEventPayload> & {
  close(): Promise<void>
}

export type CreateWatchStream = (path: string) => WatchStream

export class FilesystemClient {
  constructor(
    private readonly rpc: RpcClient,
    private readonly createWatchStream: CreateWatchStream
  ) {}

  async readFile(path: string): Promise<ReadFileResult> {
    return this.rpc.request<ReadFileResult>('filesystem.readFile', { path })
  }

  async readDir(path: string): Promise<ReadDirEntry[]> {
    return this.rpc.request<ReadDirEntry[]>('filesystem.readDir', { path })
  }

  watch(path: string): WatchStream {
    return this.createWatchStream(path)
  }
}

export function createWatchQueue(
  subscriptionId: string,
  onClose: (subscriptionId: string) => Promise<void>
): {
  enqueue(payload: unknown): void
  fail(error: unknown): void
  stream: WatchStream
} {
  const queue = new AsyncQueue<WatchEventPayload>()

  return {
    enqueue(payload: unknown) {
      queue.push(parseWatchEventPayload(payload))
    },
    fail(error: unknown) {
      queue.fail(error)
    },
    stream: {
      [Symbol.asyncIterator]() {
        return queue
      },
      async close() {
        queue.close()
        await onClose(subscriptionId)
      }
    }
  }
}
