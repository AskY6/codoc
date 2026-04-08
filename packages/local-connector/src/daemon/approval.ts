import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

import type { FilesystemPermission, GrantRecord } from '../shared/types'

type ApprovalRequest = {
  origin: string
  clientId: string
  productName: string
  permissions: FilesystemPermission[]
  existingGrant: GrantRecord | null
}

type ApprovalResult = {
  approved: boolean
  rootPath?: string
}

export class ApprovalManager {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly input: Readable = process.stdin,
    private readonly output: Writable = process.stdout
  ) {}

  request(request: ApprovalRequest): Promise<ApprovalResult> {
    const run = this.queue.then(() => this.prompt(request))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async prompt(request: ApprovalRequest): Promise<ApprovalResult> {
    if (!isTTYStream(this.input) || !isTTYStream(this.output)) {
      this.output.write('Approval skipped because daemon is not attached to a TTY.\n')
      return { approved: false }
    }

    const rl = createInterface({
      input: this.input,
      output: this.output
    })

    try {
      this.output.write('\nNew local access request\n')
      this.output.write(`  Origin: ${request.origin}\n`)
      this.output.write(`  Client: ${request.clientId}\n`)
      this.output.write(`  Product: ${request.productName}\n`)
      this.output.write(`  Permissions: ${request.permissions.join(', ')}\n`)

      if (request.existingGrant) {
        this.output.write(`  Existing root: ${request.existingGrant.capability.rootPath}\n`)
      }

      const allow = (await rl.question('Allow this request? (y/N) ')).trim().toLowerCase()

      if (allow !== 'y' && allow !== 'yes') {
        return { approved: false }
      }

      if (request.existingGrant) {
        return {
          approved: true,
          rootPath: request.existingGrant.capability.rootPath
        }
      }

      while (true) {
        const answer = (await rl.question('Enter an absolute directory path to grant: ')).trim()
        const rootPath = resolve(answer)

        try {
          const info = await stat(rootPath)

          if (!info.isDirectory()) {
            this.output.write('The selected path is not a directory.\n')
            continue
          }

          return { approved: true, rootPath }
        } catch {
          this.output.write('The selected path does not exist.\n')
        }
      }
    } finally {
      rl.close()
    }
  }
}

function isTTYStream(stream: Readable | Writable): stream is Readable & Writable & { isTTY: true } {
  return Boolean((stream as { isTTY?: boolean }).isTTY)
}
