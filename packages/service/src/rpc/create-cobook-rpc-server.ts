import type { CobookService } from "../cobook-service.js";
import type { ChatEvent } from "../ai/index.js";
import type { WorkspaceWatchEvent } from "../cobook-service.js";

import type {
  ServiceRpcRequest,
  ServiceRpcResponse,
  WatchRpcNextResult
} from "./types.js";

export interface CobookRpcServer {
  handle(request: ServiceRpcRequest): Promise<ServiceRpcResponse>;
}

export function createCobookRpcServer(service: CobookService): CobookRpcServer {
  const watchSubscriptions = new Map<string, WatchSubscription>();

  return {
    async handle(request) {
      try {
        const result = await handleRequest(service, request, watchSubscriptions);
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

async function handleRequest(
  service: CobookService,
  request: ServiceRpcRequest,
  watchSubscriptions: Map<string, WatchSubscription>
): Promise<unknown> {
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
    case "watchStart":
      return startWatchSubscription(
        service,
        watchSubscriptions,
        expectObjectWithString(request.params, "watchId")
      );
    case "watchNext":
      return nextWatchEvent(
        watchSubscriptions,
        expectObjectWithString(request.params, "watchId")
      );
    case "watchStop":
      return stopWatchSubscription(
        watchSubscriptions,
        expectObjectWithString(request.params, "watchId")
      );
  }
}

interface WatchSubscription {
  queue: WorkspaceWatchEvent[];
  waiting: Array<() => void>;
  iterator: AsyncIterator<WorkspaceWatchEvent>;
  controller: AbortController;
  done: boolean;
  error: Error | null;
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

function startWatchSubscription(
  service: CobookService,
  watchSubscriptions: Map<string, WatchSubscription>,
  watchId: string
): { watchId: string } {
  if (watchSubscriptions.has(watchId)) {
    throw new Error(`RPC watch "${watchId}" already exists.`);
  }

  const controller = new AbortController();
  const iterator = service.watch(controller.signal)[Symbol.asyncIterator]();
  const subscription: WatchSubscription = {
    queue: [],
    waiting: [],
    iterator,
    controller,
    done: false,
    error: null
  };

  watchSubscriptions.set(watchId, subscription);

  void pumpWatchSubscription(watchId, subscription, watchSubscriptions);

  return {
    watchId
  };
}

async function nextWatchEvent(
  watchSubscriptions: Map<string, WatchSubscription>,
  watchId: string
): Promise<WatchRpcNextResult> {
  const subscription = requireWatchSubscription(watchSubscriptions, watchId);

  while (subscription.queue.length === 0 && !subscription.done && !subscription.error) {
    await new Promise<void>((resolve) => {
      subscription.waiting.push(resolve);
    });
  }

  if (subscription.error) {
    const error = subscription.error;
    await cleanupWatchSubscription(watchId, subscription, watchSubscriptions);
    throw error;
  }

  const event = subscription.queue.shift();
  if (event) {
    return {
      done: false,
      event
    };
  }

  await cleanupWatchSubscription(watchId, subscription, watchSubscriptions);
  return {
    done: true
  };
}

async function stopWatchSubscription(
  watchSubscriptions: Map<string, WatchSubscription>,
  watchId: string
): Promise<{ stopped: true }> {
  const subscription = watchSubscriptions.get(watchId);
  if (subscription) {
    await cleanupWatchSubscription(watchId, subscription, watchSubscriptions);
  }

  return {
    stopped: true
  };
}

async function pumpWatchSubscription(
  watchId: string,
  subscription: WatchSubscription,
  watchSubscriptions: Map<string, WatchSubscription>
): Promise<void> {
  try {
    while (true) {
      const next = await subscription.iterator.next();
      if (next.done) {
        subscription.done = true;
        flushWatchWaiters(subscription);
        return;
      }

      subscription.queue.push(next.value);
      flushWatchWaiters(subscription);
    }
  } catch (error) {
    subscription.error = error instanceof Error ? error : new Error(String(error));
    flushWatchWaiters(subscription);
  } finally {
    if (watchSubscriptions.get(watchId) === subscription) {
      subscription.done = true;
      flushWatchWaiters(subscription);
    }
  }
}

async function cleanupWatchSubscription(
  watchId: string,
  subscription: WatchSubscription,
  watchSubscriptions: Map<string, WatchSubscription>
): Promise<void> {
  if (watchSubscriptions.get(watchId) !== subscription) {
    return;
  }

  watchSubscriptions.delete(watchId);
  subscription.done = true;
  subscription.controller.abort();
  flushWatchWaiters(subscription);
  await subscription.iterator.return?.();
}

function requireWatchSubscription(
  watchSubscriptions: Map<string, WatchSubscription>,
  watchId: string
): WatchSubscription {
  const subscription = watchSubscriptions.get(watchId);
  if (!subscription) {
    throw new Error(`RPC watch "${watchId}" was not found.`);
  }

  return subscription;
}

function flushWatchWaiters(subscription: WatchSubscription): void {
  for (const wake of subscription.waiting.splice(0)) {
    wake();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
