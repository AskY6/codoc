import { Command } from "commander";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = resolve(homedir(), ".cobook");
const STATE_FILE = resolve(STATE_DIR, "daemon.json");

interface DaemonState {
  pid: number;
  port: number;
  startedAt: string;
}

function readState(): DaemonState | undefined {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as DaemonState;
  } catch {
    return undefined;
  }
}

function writeState(state: DaemonState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function removeState(): void {
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerServerCommand(program: Command): void {
  const server = program.command("server").description("Manage the cobook server daemon");

  server
    .command("start")
    .description("Start the server in the background")
    .option("-p, --port <port>", "Server port", "3100")
    .action(async (opts: { port: string }) => {
      const existing = readState();
      if (existing && isProcessRunning(existing.pid)) {
        console.log(
          `Server already running (PID ${existing.pid}, port ${existing.port})`,
        );
        return;
      }

      const port = Number(opts.port);

      // Find the server entry point
      // In dev: use tsx; in prod: use node with built dist
      const serverDir = findServerDir();
      if (!serverDir) {
        console.error(
          "Cannot locate server package. Make sure you are in the cobook monorepo or server is installed.",
        );
        process.exit(1);
      }

      const entryPoint = resolve(serverDir, "src/index.ts");
      const distEntry = resolve(serverDir, "dist/index.js");

      let cmd: string;
      let args: string[];

      if (existsSync(distEntry)) {
        cmd = process.execPath; // node
        args = [distEntry];
      } else if (existsSync(entryPoint)) {
        cmd = "npx";
        args = ["tsx", entryPoint];
      } else {
        console.error("Cannot find server entry point. Run `pnpm turbo build` first.");
        process.exit(1);
      }

      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PORT: String(port) },
      });

      child.unref();

      if (!child.pid) {
        console.error("Failed to start server process");
        process.exit(1);
      }

      writeState({
        pid: child.pid,
        port,
        startedAt: new Date().toISOString(),
      });

      // Wait briefly and check if server responds
      await new Promise((r) => setTimeout(r, 1500));

      try {
        const res = await fetch(`http://localhost:${port}/`);
        if (res.ok) {
          console.log(`Server started (PID ${child.pid}, port ${port})`);
          return;
        }
      } catch {
        // Server may still be starting up
      }

      console.log(
        `Server process spawned (PID ${child.pid}, port ${port}). It may take a moment to be ready.`,
      );
    });

  server
    .command("stop")
    .description("Stop the background server")
    .action(() => {
      const state = readState();
      if (!state) {
        console.log("No server state found. Server may not be running.");
        return;
      }

      if (!isProcessRunning(state.pid)) {
        console.log("Server process is not running. Cleaning up state.");
        removeState();
        return;
      }

      try {
        process.kill(state.pid, "SIGTERM");
        console.log(`Stopped server (PID ${state.pid})`);
      } catch {
        console.error(`Failed to stop server (PID ${state.pid})`);
      }
      removeState();
    });

  server
    .command("status")
    .description("Check if the server is running")
    .action(async () => {
      const state = readState();
      if (!state) {
        console.log("Server is not running (no daemon state)");
        return;
      }

      if (!isProcessRunning(state.pid)) {
        console.log("Server process is not running (stale state). Cleaning up.");
        removeState();
        return;
      }

      try {
        const res = await fetch(`http://localhost:${state.port}/`);
        if (res.ok) {
          console.log(
            `Server is running (PID ${state.pid}, port ${state.port}, started ${state.startedAt})`,
          );
          return;
        }
      } catch {
        // fall through
      }
      console.log(
        `Server process is alive (PID ${state.pid}) but not responding on port ${state.port}`,
      );
    });
}

/**
 * Attempt to locate the apps/server directory.
 * Works when CLI is run from within the monorepo.
 */
function findServerDir(): string | undefined {
  // Walk up from this file or CWD to find the monorepo root
  let dir = process.cwd();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const candidate = resolve(dir, "apps/server");
    if (existsSync(resolve(candidate, "package.json"))) {
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
