#!/usr/bin/env node

import { createLocalConnectorServer } from './server'
import { GrantStore } from './grants'

async function run(): Promise<void> {
  const [command = 'start', ...args] = process.argv.slice(2)

  if (command === 'start') {
    const server = createLocalConnectorServer()
    await server.start()

    const shutdown = async () => {
      await server.stop()
      process.exit(0)
    }

    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())
    return
  }

  if (command === 'grants') {
    const [subcommand, origin, clientId] = args
    const store = new GrantStore()

    if (subcommand === 'list') {
      const grants = await store.list()

      if (grants.length === 0) {
        console.log('No grants recorded.')
        return
      }

      for (const grant of grants) {
        console.log(`${grant.origin} ${grant.clientId}`)
        console.log(`  product: ${grant.productName}`)
        console.log(`  root: ${grant.capability.rootPath}`)
        console.log(`  permissions: ${grant.capability.permissions.join(', ')}`)
        console.log(`  updatedAt: ${grant.updatedAt}`)
      }
      return
    }

    if (subcommand === 'revoke') {
      if (!origin || !clientId) {
        throw new Error('Usage: local-connector grants revoke <origin> <clientId>')
      }

      const revoked = await store.revoke(origin, clientId)
      console.log(revoked ? 'Grant revoked.' : 'Grant not found.')
      return
    }
  }

  throw new Error(
    [
      'Unknown command.',
      'Usage:',
      '  local-connector start',
      '  local-connector grants list',
      '  local-connector grants revoke <origin> <clientId>'
    ].join('\n')
  )
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
