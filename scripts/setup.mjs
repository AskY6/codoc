import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env");

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

function resolveCommand(command) {
  return command === "pnpm" && process.platform === "win32" ? "pnpm.cmd" : command;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(resolveCommand(command), args, {
      cwd: rootDir,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let stdout = "";
    let stderr = "";

    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      resolveRun({
        code: code ?? (signal ? 1 : 0),
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isRetryableDatabaseError(output) {
  return (
    output.includes("ECONNREFUSED") ||
    output.includes("database system is starting up") ||
    output.includes("Connection terminated unexpectedly") ||
    output.includes("connect ECONNREFUSED") ||
    output.includes("the database system is starting up")
  );
}

if (!existsSync(envPath)) {
  console.error("Missing .env file. Copy .env.example to .env first.");
  process.exit(1);
}

const env = { ...process.env, ...parseEnvFile(envPath) };

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in .env.");
  process.exit(1);
}

console.log("Starting PostgreSQL with Docker...");
const dbUp = await run("docker", ["compose", "up", "-d", "postgres"], {
  capture: true,
});
if (dbUp.code !== 0) {
  const combinedOutput = `${dbUp.stdout}\n${dbUp.stderr}`;
  if (
    combinedOutput.includes("port is already allocated") ||
    combinedOutput.includes("address already in use")
  ) {
    console.warn("PostgreSQL port is already in use. Continuing and assuming your database is already running.");
  } else {
    if (combinedOutput.trim()) {
      process.stderr.write(combinedOutput);
    }
    console.error("Failed to start PostgreSQL via Docker Compose.");
    process.exit(dbUp.code);
  }
} else if (dbUp.stdout.trim()) {
  process.stdout.write(dbUp.stdout);
}

console.log("Waiting for PostgreSQL to accept connections...");
let migrateSucceeded = false;
let lastFailure = null;

for (let attempt = 1; attempt <= 15; attempt += 1) {
  const result = await run("pnpm", ["db:migrate"], { capture: true, env });
  if (result.code === 0) {
    if (result.stdout.trim()) {
      process.stdout.write(result.stdout);
    }
    migrateSucceeded = true;
    break;
  }

  lastFailure = result;
  const combinedOutput = `${result.stdout}\n${result.stderr}`;

  if (combinedOutput.includes("already exists")) {
    console.warn("Database schema already exists without a clean migration history. Skipping migrations and continuing to seed.");
    migrateSucceeded = true;
    break;
  }

  if (!isRetryableDatabaseError(combinedOutput)) {
    break;
  }

  process.stdout.write(`PostgreSQL not ready yet (attempt ${attempt}/15)\n`);
  await sleep(2000);
}

if (!migrateSucceeded) {
  console.error("Failed to apply migrations after waiting for PostgreSQL.");
  if (lastFailure?.stderr?.trim()) {
    process.stderr.write(lastFailure.stderr);
  }
  process.exit(1);
}

console.log("Setup complete. Run `pnpm dev` for local development.");
