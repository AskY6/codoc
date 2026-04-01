import type { CobookService } from "../cobook-service.js";
import type { ChatEvent } from "../ai/index.js";

import type { ServiceRpcRequest, ServiceRpcResponse } from "./types.js";

export interface CobookRpcServer {
  handle(request: ServiceRpcRequest): Promise<ServiceRpcResponse>;
}

export function createCobookRpcServer(service: CobookService): CobookRpcServer {
  return {
    async handle(request) {
      try {
        const result = await handleRequest(service, request);
        return {
          id: request.id,
          ok: true,
          result
        };
      } catch (error) {
        return {
          id: request.id,
          ok: false,
          error: {
            message: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  };
}

async function handleRequest(service: CobookService, request: ServiceRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "openWorkspace":
      return service.openWorkspace(expectObjectWithString(request.params, "root"));
    case "getWorkspace":
      return service.getWorkspace();
    case "build":
      return service.build();
    case "rebuildCodoc":
      return service.rebuildCodoc(expectObjectWithString(request.params, "codocId"));
    case "listCodocs":
      return service.listCodocs();
    case "readCodoc":
      return service.readCodoc(expectObjectWithString(request.params, "codocId"));
    case "writeCodoc":
      return service.writeCodoc(expectWriteInput(request.params));
    case "invalidate":
      return service.invalidate(expectObjectWithString(request.params, "node"));
    case "resolve":
      return service.resolve(expectObjectWithString(request.params, "node"));
    case "graph":
      return service.graph();
    case "diagnostics":
      return service.diagnostics();
    case "chat":
      return collectEvents(service.chat(expectChatInput(request.params)));
  }
}

function expectObjectWithString(params: unknown, key: string): string {
  if (!isRecord(params) || typeof params[key] !== "string") {
    throw new Error(`RPC params must include string field "${key}".`);
  }

  return params[key];
}

function expectWriteInput(params: unknown) {
  if (
    !isRecord(params) ||
    typeof params.codocId !== "string" ||
    typeof params.filePath !== "string" ||
    typeof params.content !== "string"
  ) {
    throw new Error("RPC writeCodoc params are invalid.");
  }

  return {
    codocId: params.codocId,
    filePath: params.filePath,
    content: params.content,
    ...(typeof params.overwrite === "boolean" ? { overwrite: params.overwrite } : {})
  };
}

function expectChatInput(params: unknown) {
  if (!isRecord(params) || typeof params.message !== "string") {
    throw new Error('RPC chat params must include string field "message".');
  }

  return {
    message: params.message,
    ...(Array.isArray(params.pinnedCodocIds) &&
    params.pinnedCodocIds.every((entry) => typeof entry === "string")
      ? { pinnedCodocIds: params.pinnedCodocIds }
      : {})
  };
}

async function collectEvents(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
