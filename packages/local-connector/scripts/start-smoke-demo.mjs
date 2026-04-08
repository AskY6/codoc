import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { extname, join, normalize, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const repoRoot = resolve(__dirname, '..')

const HOST = '127.0.0.1'
const WEB_PORT = 5173
const DEMO_URL = `http://${HOST}:${WEB_PORT}/examples/smoke-web/index.html`

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
}

let daemonProcess = null
let webServer = null
let shuttingDown = false

async function main() {
  await run('pnpm', ['build'], { stdio: 'inherit' })
  await assertFile(join(repoRoot, 'dist', 'daemon', 'main.js'))
  await assertFile(join(repoRoot, 'dist', 'client', 'browser.js'))

  daemonProcess = spawn('node', ['dist/daemon/main.js', 'start'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })

  daemonProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    console.error(
      signal
        ? `Daemon exited because of signal ${signal}.`
        : `Daemon exited with code ${String(code)}.`
    )
    void shutdown(code ?? 1)
  })

  webServer = http.createServer((request, response) => {
    void serveRequest(request, response)
  })

  await listen(webServer, WEB_PORT, HOST)

  console.log('')
  console.log('Smoke demo is ready.')
  console.log(`  Web:    ${DEMO_URL}`)
  console.log(`  Daemon: ws://127.0.0.1:3999`)
  console.log('')
  console.log('Suggested flow:')
  console.log('  1. Open the demo URL')
  console.log('  2. Click Connect')
  console.log('  3. Approve in this terminal and enter a root directory')
  console.log('  4. Try ReadDir("."), ReadFile, and Start Watch')
  console.log('')
  console.log('Press Ctrl+C to stop both services.')

  process.on('SIGINT', () => {
    void shutdown(0)
  })

  process.on('SIGTERM', () => {
    void shutdown(0)
  })
}

async function serveRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${HOST}:${WEB_PORT}`)
  let pathname = decodeURIComponent(requestUrl.pathname)

  if (pathname === '/') {
    pathname = '/examples/smoke-web/index.html'
  }

  const resolvedPath = resolve(repoRoot, `.${pathname}`)
  const normalizedRoot = normalize(`${repoRoot}/`)
  const normalizedPath = normalize(resolvedPath)

  if (!normalizedPath.startsWith(normalizedRoot) && normalizedPath !== normalize(repoRoot)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Forbidden')
    return
  }

  let filePath = normalizedPath

  try {
    const info = await stat(filePath)
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
    return
  }

  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not Found')
      return
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
    return
  }

  response.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-store'
  })

  createReadStream(filePath).pipe(response)
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream'
}

async function assertFile(filePath) {
  await access(filePath)
}

async function listen(server, port, host) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.off('error', rejectPromise)
      resolvePromise()
    })
  })
}

async function run(command, args, options) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      ...options
    })

    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}`))
    })
  })
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  if (webServer) {
    await new Promise((resolvePromise) => {
      webServer.close(() => resolvePromise())
    })
  }

  if (daemonProcess && !daemonProcess.killed) {
    daemonProcess.kill('SIGINT')
    await new Promise((resolvePromise) => {
      daemonProcess.once('exit', () => resolvePromise())
      setTimeout(() => resolvePromise(), 2_000)
    })
  }

  process.exit(exitCode)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  void shutdown(1)
})
