import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function main() {
  const parsed = parseArgs(argv.slice(2));
  const backendUrl = `http://${parsed.backendHost}:${parsed.backendPort}`;
  const webUrl = `http://${parsed.webHost}:${parsed.webPort}`;
  const children = new Set();
  let shuttingDown = false;

  stdout.write(
    [
      "Starting Cobook Dev",
      `workspace: ${resolve(repoRoot, parsed.root)}`,
      `backend: ${backendUrl}`,
      `web: ${webUrl}`
    ].join("\n") + "\n"
  );

  const backend = spawn(
    process.execPath,
    [
      resolve(repoRoot, "scripts", "start-backend.mjs"),
      "--root",
      parsed.root,
      "--host",
      parsed.backendHost,
      "--port",
      String(parsed.backendPort)
    ],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit"
    }
  );
  children.add(backend);

  const web = spawn(
    "pnpm",
    [
      "--dir",
      resolve(repoRoot, "apps", "web"),
      "dev",
      "--",
      "--host",
      parsed.webHost,
      "--port",
      String(parsed.webPort)
    ],
    {
      cwd: repoRoot,
      env: {
        ...env,
        COBOOK_API_ORIGIN: backendUrl,
        COBOOK_WEB_HOST: parsed.webHost,
        COBOOK_WEB_PORT: String(parsed.webPort)
      },
      stdio: "inherit"
    }
  );
  children.add(web);

  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  }

  function handleExit(label, child) {
    return (code, signal) => {
      children.delete(child);
      if (!shuttingDown) {
        shutdown("SIGTERM");
      }

      if (signal) {
        exit(1);
        return;
      }

      if (code && code !== 0) {
        stdout.write(`${label} exited with code ${code}\n`);
        exit(code);
        return;
      }

      if (children.size === 0) {
        exit(0);
      }
    };
  }

  backend.on("exit", handleExit("backend", backend));
  web.on("exit", handleExit("web", web));

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

function parseArgs(rawArgv) {
  let root = "examples/hello-cobook";
  let backendHost = "127.0.0.1";
  let backendPort = 4310;
  let webHost = "127.0.0.1";
  let webPort = 5173;

  for (let index = 0; index < rawArgv.length; index += 1) {
    const entry = rawArgv[index];
    if (!entry || entry === "--") {
      continue;
    }

    if (entry === "--root") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--root".');
      }

      root = next;
      index += 1;
      continue;
    }

    if (entry === "--backend-host") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--backend-host".');
      }

      backendHost = next;
      index += 1;
      continue;
    }

    if (entry === "--backend-port") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--backend-port".');
      }

      backendPort = parsePort(next, "--backend-port");
      index += 1;
      continue;
    }

    if (entry === "--web-host") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--web-host".');
      }

      webHost = next;
      index += 1;
      continue;
    }

    if (entry === "--web-port") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--web-port".');
      }

      webPort = parsePort(next, "--web-port");
      index += 1;
    }
  }

  return {
    root,
    backendHost,
    backendPort,
    webHost,
    webPort
  };
}

function parsePort(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid port "${value}" for "${flagName}".`);
  }

  return parsed;
}

main();
