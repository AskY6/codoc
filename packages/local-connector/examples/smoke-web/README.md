# Smoke Demo

## Purpose

This demo is the smallest browser page for validating the Phase 1 flow:

- connect to the local daemon
- approve access in the daemon terminal
- call `readDir`
- call `readFile`
- receive `watch` events

## Run

From the repo root:

```bash
pnpm smoke
```

This command will:

- build the project
- start the daemon on `ws://127.0.0.1:3999`
- start the static web server on `http://127.0.0.1:5173`

Then open:

```text
http://127.0.0.1:5173/examples/smoke-web/index.html
```

Use `127.0.0.1` consistently for the static server origin. Do not switch between `localhost` and `127.0.0.1`, because grants are keyed by `Origin + clientId`.

## Suggested Demo Flow

1. Click `Connect`
2. Approve the request in the daemon terminal
3. Enter a granted relative path and click `ReadDir`
4. Enter a granted relative file path and click `ReadFile`
5. Click `Start Watch`
6. Modify a file under the granted root and confirm events appear in the log
