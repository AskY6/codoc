import { spawn } from "node:child_process";

function resolveCommand(command) {
  return command === "pnpm" && process.platform === "win32" ? "pnpm.cmd" : command;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(resolveCommand(command), args, {
      cwd: process.cwd(),
      env: process.env,
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

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

console.log("Waiting for PostgreSQL and applying migrations...");

let migrateSucceeded = false;
let lastFailure = null;

for (let attempt = 1; attempt <= 20; attempt += 1) {
  const result = await run("pnpm", ["--filter", "@cobook/service", "db:migrate"], {
    capture: true,
  });

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
    console.warn("Database schema already exists without a clean migration history. Skipping migrations.");
    migrateSucceeded = true;
    break;
  }

  if (!isRetryableDatabaseError(combinedOutput)) {
    if (combinedOutput.trim()) {
      process.stderr.write(combinedOutput);
    }
    process.exit(result.code || 1);
  }

  console.log(`Database not ready yet (attempt ${attempt}/20)`);
  await sleep(2000);
}

if (!migrateSucceeded) {
  if (lastFailure) {
    process.stderr.write(`${lastFailure.stdout}\n${lastFailure.stderr}`);
  }
  console.error("Failed to apply migrations in container.");
  process.exit(1);
}

console.log("Seeding demo workspace...");
const seed = await run("pnpm", ["--filter", "@cobook/service", "db:seed"]);
if (seed.code !== 0) {
  process.exit(seed.code);
}

console.log("Starting server...");
const server = spawn(resolveCommand("pnpm"), ["--filter", "@cobook/server", "dev"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

function shutdown(signal = "SIGTERM") {
  if (!server.killed) {
    server.kill(signal);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

server.on("error", (error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
