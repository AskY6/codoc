# Scripts

## Smoke Demo

Run the full Phase 1 smoke setup with one command:

```bash
pnpm smoke
```

This command will:

1. Build the project
2. Start the local connector daemon
3. Start a static web server on `http://127.0.0.1:5173`

Open:

```text
http://127.0.0.1:5173/examples/smoke-web/index.html
```

Press `Ctrl+C` to stop both services.
