import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const envPath = resolve(process.cwd(), ".env");

function parseEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[match[1]] = value;
  }

  return parsed;
}

if (!existsSync(envPath)) {
  console.error("Missing .env file. Copy .env.example to .env first.");
  process.exit(1);
}

if (process.argv.length < 3) {
  console.error("Usage: node scripts/run-with-env.mjs <command> [args...]");
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0] === "pnpm" && process.platform === "win32"
  ? "pnpm.cmd"
  : args[0];
const commandArgs = args.slice(1);
const env = { ...process.env, ...parseEnvFile(envPath) };

const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Failed to start command: ${error.message}`);
  process.exit(1);
});
