import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { FilesystemPermission, GrantFile, GrantRecord } from '../shared/types'

function getConfigDirectory(appName: string): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName)
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, appName)
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), appName)
}

export function createGrantKey(origin: string, clientId: string): string {
  return `${origin}::${clientId}`
}

export class GrantStore {
  readonly filePath: string

  constructor(filePath = join(getConfigDirectory('local-connector'), 'grants.json')) {
    this.filePath = filePath
  }

  async list(): Promise<GrantRecord[]> {
    const file = await this.readGrantFile()
    return file.grants
  }

  async find(origin: string, clientId: string): Promise<GrantRecord | null> {
    const grants = await this.list()
    return grants.find((grant) => grant.origin === origin && grant.clientId === clientId) ?? null
  }

  async upsert(input: {
    origin: string
    clientId: string
    productName: string
    rootPath: string
    permissions: FilesystemPermission[]
  }): Promise<GrantRecord> {
    const file = await this.readGrantFile()
    const now = new Date().toISOString()
    const existingIndex = file.grants.findIndex(
      (grant) => grant.origin === input.origin && grant.clientId === input.clientId
    )

    const record: GrantRecord = {
      id: existingIndex >= 0 ? file.grants[existingIndex]!.id : randomUUID(),
      origin: input.origin,
      clientId: input.clientId,
      productName: input.productName,
      capability: {
        type: 'filesystem',
        rootPath: input.rootPath,
        permissions: [...new Set(input.permissions)]
      },
      grantedAt: existingIndex >= 0 ? file.grants[existingIndex]!.grantedAt : now,
      updatedAt: now
    }

    if (existingIndex >= 0) {
      file.grants[existingIndex] = record
    } else {
      file.grants.push(record)
    }

    await this.writeGrantFile(file)
    return record
  }

  async revoke(origin: string, clientId: string): Promise<boolean> {
    const file = await this.readGrantFile()
    const nextGrants = file.grants.filter((grant) => !(grant.origin === origin && grant.clientId === clientId))

    if (nextGrants.length === file.grants.length) {
      return false
    }

    await this.writeGrantFile({
      version: 1,
      grants: nextGrants
    })

    return true
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
  }

  private async readGrantFile(): Promise<GrantFile> {
    try {
      const content = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(content) as Partial<GrantFile>

      if (parsed.version !== 1 || !Array.isArray(parsed.grants)) {
        return { version: 1, grants: [] }
      }

      return {
        version: 1,
        grants: parsed.grants as GrantRecord[]
      }
    } catch {
      return { version: 1, grants: [] }
    }
  }

  private async writeGrantFile(file: GrantFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  }
}
