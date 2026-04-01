import { createInterface } from "node:readline";
import { cwd, exit, stderr, stdin, stdout, argv } from "node:process";
import { resolve as resolvePath } from "node:path";

import {
  createCobookRpcServer,
  type ServiceRpcRequest,
  type ServiceRpcResponse
} from "@cobook/service";

import { createAppService } from "./create-service.js";
import { startHttpServer } from "./http-server.js";

interface ServerArgs {
  mode: "stdio" | "http";
  root?: string;
  port?: number;
  host?: string;
  staticRoot: string;
}

const parsed = parseServerArgs(argv.slice(2));

if (parsed.mode === "http") {
  void runHttpServer(parsed);
} else {
  runStdioServer();
}

function runStdioServer(): void {
  const service = createAppService();
  const server = createCobookRpcServer(service);
  const input = createInterface({
    input: stdin,
    crlfDelay: Infinity
  });

  let queue = Promise.resolve();

  input.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    queue = queue
      .then(async () => {
        const request = parseRequest(trimmed);
        const response = request
          ? await server.handle(request)
          : invalidRequestResponse("Failed to parse RPC request.");

        stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => {
        stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      });
  });

  input.on("close", () => {
    exit(0);
  });
}

async function runHttpServer(args: ServerArgs): Promise<void> {
  if (!args.root) {
    throw new Error('HTTP server mode requires "--root <path>".');
  }

  const service = createAppService();
  await service.openWorkspace(args.root);

  const started = await startHttpServer({
    service,
    staticRoot: args.staticRoot,
    ...(args.host ? { host: args.host } : {}),
    ...(args.port !== undefined ? { port: args.port } : {})
  });

  stdout.write(`Listening on http://${started.host}:${started.port}\n`);
}

function parseRequest(line: string): ServiceRpcRequest | null {
  try {
    const parsed = JSON.parse(line);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof parsed.id !== "string" ||
      typeof parsed.method !== "string"
    ) {
      return null;
    }

    return parsed as ServiceRpcRequest;
  } catch {
    return null;
  }
}

function invalidRequestResponse(message: string): ServiceRpcResponse {
  return {
    id: "invalid-request",
    ok: false,
    error: {
      message
    }
  };
}

function parseServerArgs(rawArgv: string[]): ServerArgs {
  const mode = rawArgv[0] === "http" ? "http" : "stdio";
  let root: string | undefined;
  let port: number | undefined;
  let host: string | undefined;
  let staticRoot = resolvePath(
    cwd(),
    "apps",
    "web",
    "public"
  );

  const args = mode === "http" ? rawArgv.slice(1) : rawArgv;
  for (let index = 0; index < args.length; index += 1) {
    const entry = args[index];
    if (!entry) {
      continue;
    }

    if (entry === "--root") {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for "--root".');
      }

      root = resolvePath(next);
      index += 1;
      continue;
    }

    if (entry === "--port") {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for "--port".');
      }

      port = Number.parseInt(next, 10);
      if (Number.isNaN(port)) {
        throw new Error(`Invalid port "${next}".`);
      }

      index += 1;
      continue;
    }

    if (entry === "--host") {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for "--host".');
      }

      host = next;
      index += 1;
      continue;
    }

    if (entry === "--static-root") {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for "--static-root".');
      }

      staticRoot = resolvePath(next);
      index += 1;
    }
  }

  return {
    mode,
    ...(root ? { root } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(host ? { host } : {}),
    staticRoot
  };
}
