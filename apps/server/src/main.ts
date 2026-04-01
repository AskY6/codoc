import { createInterface } from "node:readline";
import { exit, stderr, stdin, stdout } from "node:process";

import { RuleBasedBaseAgent } from "@cobook/agent";
import {
  LocalCobookService,
  createCobookRpcServer,
  type ServiceRpcRequest,
  type ServiceRpcResponse
} from "@cobook/service";

const agent = new RuleBasedBaseAgent();
const service = new LocalCobookService({
  chatHandler: (input, boundService) => agent.run(input, boundService)
});
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
