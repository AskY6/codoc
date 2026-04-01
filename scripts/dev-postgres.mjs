import { spawnSync } from "node:child_process";
import { argv, exit, stderr, stdout } from "node:process";

const IMAGE = "postgres:15";
const CONTAINER_NAME = "cobook-postgres-dev";
const VOLUME_NAME = "cobook-postgres-dev-data";
const HOST_PORT = 55432;
const DATABASE = "cobook_dev";
const USER = "postgres";
const PASSWORD = "postgres";
const CONNECTION_STRING = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${HOST_PORT}/${DATABASE}`;

main();

function main() {
  const command = argv[2] ?? "up";
  const quiet = argv.includes("--quiet");

  try {
    if (command === "up") {
      ensureContainerUp(quiet);
      if (!quiet) {
        stdout.write(`${CONNECTION_STRING}\n`);
      }
      return;
    }

    if (command === "down") {
      removeContainer();
      return;
    }

    if (command === "reset") {
      removeContainer();
      removeVolume();
      ensureContainerUp(quiet);
      if (!quiet) {
        stdout.write(`${CONNECTION_STRING}\n`);
      }
      return;
    }

    if (command === "url") {
      stdout.write(`${CONNECTION_STRING}\n`);
      return;
    }

    throw new Error(`Unsupported command "${command}". Use up, down, reset, or url.`);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  }
}

function ensureContainerUp(quiet) {
  const status = readContainerStatus();
  if (status === "running") {
    waitUntilReady();
    return;
  }

  if (status === "stopped") {
    runDocker(["start", CONTAINER_NAME], quiet);
    waitUntilReady();
    return;
  }

  runDocker(
    [
      "run",
      "--detach",
      "--name",
      CONTAINER_NAME,
      "--publish",
      `127.0.0.1:${HOST_PORT}:5432`,
      "--env",
      `POSTGRES_DB=${DATABASE}`,
      "--env",
      `POSTGRES_USER=${USER}`,
      "--env",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "--volume",
      `${VOLUME_NAME}:/var/lib/postgresql/data`,
      IMAGE
    ],
    quiet
  );
  waitUntilReady();
}

function readContainerStatus() {
  const result = runDocker(
    ["ps", "-a", "--filter", `name=^/${CONTAINER_NAME}$`, "--format", "{{.Status}}"],
    true,
    true
  );
  const status = result.stdout.trim();
  if (status.length === 0) {
    return "missing";
  }

  return status.startsWith("Up") ? "running" : "stopped";
}

function waitUntilReady() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const result = runDocker(
      ["exec", CONTAINER_NAME, "pg_isready", "-U", USER, "-d", DATABASE],
      true,
      true
    );
    if (result.status === 0) {
      return;
    }

    sleep(500);
  }

  throw new Error("Timed out waiting for the local PostgreSQL container to become ready.");
}

function removeContainer() {
  if (readContainerStatus() === "missing") {
    return;
  }

  runDocker(["rm", "--force", CONTAINER_NAME], true);
}

function removeVolume() {
  runDocker(["volume", "rm", "--force", VOLUME_NAME], true, true);
}

function runDocker(args, quiet, allowFailure = false) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit"
  });

  if (!allowFailure && result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `docker ${args.join(" ")} failed.`);
  }

  return result;
}

function sleep(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Busy wait is acceptable here because the helper runs only during local bootstrap.
  }
}
