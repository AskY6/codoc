import { spawn } from "node:child_process";

const commands = [
  ["pnpm", ["dev:server"]],
  ["pnpm", ["dev:web"]],
];

const children = [];
let exiting = false;

function resolveCommand(command) {
  return command === "pnpm" && process.platform === "win32" ? "pnpm.cmd" : command;
}

function shutdown(signal = "SIGTERM") {
  if (exiting) return;
  exiting = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const [command, args] of commands) {
  const child = spawn(resolveCommand(command), args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (exiting) return;
    shutdown();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    if (exiting) return;
    console.error(`Failed to start ${command} ${args.join(" ")}: ${error.message}`);
    shutdown();
    process.exit(1);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});
