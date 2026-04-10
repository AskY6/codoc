import { relative } from 'node:path'

import chokidar, { type FSWatcher } from 'chokidar'

import type { WatchEventPayload } from '../shared/types'

export type WatchRegistration = {
  close(): Promise<void>
}

export class WatchManager {
  subscribe(input: {
    subscriptionId: string
    absPath: string
    rootPath: string
    onEvent: (payload: WatchEventPayload) => void
  }): WatchRegistration {
    const watcher = chokidar.watch(input.absPath, {
      ignoreInitial: true,
      persistent: true
    })

    const handler = (kind: WatchEventPayload['kind']) => (changedPath: string) => {
      input.onEvent({
        subscriptionId: input.subscriptionId,
        kind,
        path: relative(input.rootPath, changedPath).replace(/\\/gu, '/')
      })
    }

    watcher.on('add', handler('add'))
    watcher.on('change', handler('change'))
    watcher.on('unlink', handler('unlink'))
    watcher.on('addDir', handler('addDir'))
    watcher.on('unlinkDir', handler('unlinkDir'))

    return {
      async close() {
        await closeWatcher(watcher)
      }
    }
  }
}

async function closeWatcher(watcher: FSWatcher): Promise<void> {
  await watcher.close()
}
