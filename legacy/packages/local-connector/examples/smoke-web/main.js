import { ConnectorClient } from '../../dist/client/browser.js'

const statusEl = document.querySelector('#status')
const statusDetailEl = document.querySelector('#status-detail')
const dirOutputEl = document.querySelector('#dir-output')
const fileOutputEl = document.querySelector('#file-output')
const logOutputEl = document.querySelector('#log-output')

const connectBtn = document.querySelector('#connect-btn')
const disconnectBtn = document.querySelector('#disconnect-btn')
const clearLogBtn = document.querySelector('#clear-log-btn')
const readDirBtn = document.querySelector('#read-dir-btn')
const readFileBtn = document.querySelector('#read-file-btn')
const startWatchBtn = document.querySelector('#start-watch-btn')
const stopWatchBtn = document.querySelector('#stop-watch-btn')

const dirPathInput = document.querySelector('#dir-path-input')
const filePathInput = document.querySelector('#file-path-input')
const watchPathInput = document.querySelector('#watch-path-input')

let watchStream = null
let watchAbort = false

const connector = new ConnectorClient({
  clientId: 'smoke-web',
  productName: 'Smoke Demo',
  capabilities: [
    {
      type: 'filesystem',
      permissions: ['read', 'watch']
    }
  ]
})

connector.onStatusChange((status) => {
  statusEl.textContent = status

  if (status === 'auth_pending') {
    statusDetailEl.textContent = 'Waiting for approval in the daemon terminal.'
    return
  }

  if (status === 'ready') {
    statusDetailEl.textContent = 'Connected. You can read files and start a watch.'
    return
  }

  if (status === 'reconnecting') {
    statusDetailEl.textContent = 'Connection dropped. Retrying automatically.'
    return
  }

  if (status === 'connecting') {
    statusDetailEl.textContent = 'Connecting to ws://127.0.0.1:3999 ...'
    return
  }

  if (status === 'closed') {
    statusDetailEl.textContent = 'Disconnected.'
    return
  }

  statusDetailEl.textContent = 'Waiting to connect.'
})

connectBtn.addEventListener('click', async () => {
  try {
    log('connect()', 'Attempting to connect')
    await connector.connect()
    log('connect()', 'Connection established')
  } catch (error) {
    logError('connect()', error)
  }
})

disconnectBtn.addEventListener('click', () => {
  connector.disconnect()
  log('disconnect()', 'Disconnected by user')
})

clearLogBtn.addEventListener('click', () => {
  logOutputEl.textContent = ''
})

readDirBtn.addEventListener('click', async () => {
  const path = dirPathInput.value.trim() || '.'

  try {
    const entries = await connector.filesystem.readDir(path)
    dirOutputEl.innerHTML = ''

    for (const entry of entries) {
      const item = document.createElement('li')
      item.textContent = `${entry.kind === 'directory' ? 'dir ' : 'file'} ${entry.name}`
      dirOutputEl.appendChild(item)
    }

    log('readDir()', `Loaded ${entries.length} entries from "${path}"`)
  } catch (error) {
    logError('readDir()', error)
  }
})

readFileBtn.addEventListener('click', async () => {
  const path = filePathInput.value.trim()

  try {
    const result = await connector.filesystem.readFile(path)
    fileOutputEl.textContent = result.content
    log('readFile()', `Loaded "${path}" (${result.size} bytes)`)
  } catch (error) {
    fileOutputEl.textContent = 'Read failed.'
    logError('readFile()', error)
  }
})

startWatchBtn.addEventListener('click', async () => {
  const path = watchPathInput.value.trim() || '.'

  if (watchStream) {
    log('watch()', 'A watch is already running. Stop it before starting a new one.')
    return
  }

  watchAbort = false
  watchStream = connector.filesystem.watch(path)
  log('watch()', `Watch requested for "${path}"`)

  try {
    for await (const event of watchStream) {
      if (watchAbort) {
        break
      }

      log('watch:event', `${event.kind} ${event.path}`)
    }
  } catch (error) {
    logError('watch()', error)
  } finally {
    watchStream = null
  }
})

stopWatchBtn.addEventListener('click', async () => {
  if (!watchStream) {
    log('watch()', 'No active watch to stop')
    return
  }

  watchAbort = true
  await watchStream.close()
  watchStream = null
  log('watch()', 'Watch stopped')
})

function log(scope, message) {
  appendLog(`[${timestamp()}] ${scope} ${message}`)
}

function logError(scope, error) {
  const message = error instanceof Error ? error.message : String(error)
  appendLog(`[${timestamp()}] ${scope} ERROR ${message}`)
}

function appendLog(line) {
  logOutputEl.textContent = logOutputEl.textContent
    ? `${logOutputEl.textContent}\n${line}`
    : line
  logOutputEl.scrollTop = logOutputEl.scrollHeight
}

function timestamp() {
  return new Date().toLocaleTimeString()
}
