import { resolve as resolvePath } from "node:path";

import type { ChatEvent } from "../ai/index.js";
import type { CobookService, WorkspaceSnapshot, WorkspaceWatchEvent } from "../cobook-service.js";

import type {
  ServiceRpcRequest,
  ServiceRpcResponse,
  WatchRpcNextResult
} from "./types.js";

export interface CobookRpcServer {
  handle(request: ServiceRpcRequest): Promise<ServiceRpcResponse>;
}

export interface CreateCobookRpcServerOptions {
  createService: () => CobookService;
}

interface ManagedWorkspaceSession {
  key: string;
  service: CobookService;
  clientIds: Set<string>;
}

interface RpcServerState {
  createService: () => CobookService;
  workspaces: Map<string, ManagedWorkspaceSession>;
  sessions: Map<string, ManagedWorkspaceSession>;
  watchSubscriptions: Map<string, WatchSubscription>;
  nextSessionId: number;
}

interface OpenWorkspaceRpcResult {
  sessionId: string;
  workspace: WorkspaceSnapshot;
}

interface WatchSubscription {
  sessionId: string;
  queue: WorkspaceWatchEvent[];
  waiting: Array<() => void>;
  iterator: AsyncIterator<WorkspaceWatchEvent>;
  controller: AbortController;
  done: boolean;
  error: Error | null;
}

export function createCobookRpcServer(options: CreateCobookRpcServerOptions): CobookRpcServer {
  const state: RpcServerState = {
    createService: options.createService,
    workspaces: new Map(),
    sessions: new Map(),
    watchSubscriptions: new Map(),
    nextSessionId: 0
  };

  return {
    async handle(request) {
      try {
        const result = await handleRequest(state, request);
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

async function handleRequest(state: RpcServerState, request: ServiceRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "openWorkspace":
      return openWorkspaceSession(state, expectObjectWithString(request.params, "root"));
    case "closeWorkspace":
      return closeWorkspaceSession(state, expectObjectWithString(request.params, "sessionId"));
    case "getWorkspace":
      return withSessionService(state, request.params, (service) => service.getWorkspace());
    case "build":
      return withSessionService(state, request.params, (service) => service.build());
    case "rebuildCodoc":
      return withSessionService(state, request.params, (service, params) =>
        service.rebuildCodoc(expectObjectWithString(params, "codocId"))
      );
    case "listCodocs":
      return withSessionService(state, request.params, (service) => service.listCodocs());
    case "readCodoc":
      return withSessionService(state, request.params, (service, params) =>
        service.readCodoc(expectObjectWithString(params, "codocId"))
      );
    case "writeCodoc":
      return withSessionService(state, request.params, (service, params) =>
        service.writeCodoc(expectWriteInput(params))
      );
    case "invalidate":
      return withSessionService(state, request.params, (service, params) =>
        service.invalidate(expectObjectWithString(params, "node"))
      );
    case "resolve":
      return withSessionService(state, request.params, (service, params) =>
        service.resolve(expectObjectWithString(params, "node"))
      );
    case "graph":
      return withSessionService(state, request.params, (service) => service.graph());
    case "diagnostics":
      return withSessionService(state, request.params, (service) => service.diagnostics());
    case "chat":
      return withSessionService(state, request.params, (service, params) =>
        collectEvents(service.chat(expectChatInput(params)))
      );
    case "watchStart": {
      const params = expectSessionParams(request.params);
      return startWatchSubscription(
        state,
        params.sessionId,
        expectObjectWithString(params, "watchId")
      );
    }
    case "watchNext": {
      const params = expectSessionParams(request.params);
      return nextWatchEvent(
        state.watchSubscriptions,
        params.sessionId,
        expectObjectWithString(params, "watchId")
      );
    }
    case "watchStop": {
      const params = expectSessionParams(request.params);
      return stopWatchSubscription(
        state.watchSubscriptions,
        params.sessionId,
        expectObjectWithString(params, "watchId")
      );
    }
  }
}

async function openWorkspaceSession(
  state: RpcServerState,
  root: string
): Promise<OpenWorkspaceRpcResult> {
  const workspaceKey = resolvePath(root);
  let managed = state.workspaces.get(workspaceKey);
  let workspace: WorkspaceSnapshot;

  if (!managed) {
    const service = state.createService();
    workspace = await service.openWorkspace(root);
    managed = {
      key: workspaceKey,
      service,
      clientIds: new Set()
    };
    state.workspaces.set(workspaceKey, managed);
  } else {
    workspace = await managed.service.getWorkspace();
  }

  const sessionId = `session-${state.nextSessionId++}`;
  managed.clientIds.add(sessionId);
  state.sessions.set(sessionId, managed);

  return {
    sessionId,
    workspace
  };
}

async function closeWorkspaceSession(
  state: RpcServerState,
  sessionId: string
): Promise<{ closed: true }> {
  const managed = state.sessions.get(sessionId);
  if (!managed) {
    return {
      closed: true
    };
  }

  await cleanupSessionWatchSubscriptions(sessionId, state.watchSubscriptions);

  state.sessions.delete(sessionId);
  managed.clientIds.delete(sessionId);

  if (managed.clientIds.size === 0) {
    state.workspaces.delete(managed.key);
    await managed.service.closeWorkspace();
  }

  return {
    closed: true
  };
}

function expectObjectWithString(params: unknown, key: string): string {
  if (!isRecord(params) || typeof params[key] !== "string") {
    throw new Error(`RPC params must include string field "${key}".`);
  }

  return params[key];
}

function expectSessionParams(params: unknown): Record<string, unknown> & { sessionId: string } {
  if (!isRecord(params) || typeof params.sessionId !== "string") {
    throw new Error('RPC params must include string field "sessionId".');
  }

  return {
    ...params,
    sessionId: params.sessionId
  };
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
  state: RpcServerState,
  sessionId: string,
  watchId: string
): { watchId: string } {
  const subscriptionKey = getWatchSubscriptionKey(sessionId, watchId);
  if (state.watchSubscriptions.has(subscriptionKey)) {
    throw new Error(`RPC watch "${watchId}" already exists for session "${sessionId}".`);
  }

  const service = requireSessionService(state, sessionId);
  const controller = new AbortController();
  const iterator = service.watch(controller.signal)[Symbol.asyncIterator]();
  const subscription: WatchSubscription = {
    sessionId,
    queue: [],
    waiting: [],
    iterator,
    controller,
    done: false,
    error: null
  };

  state.watchSubscriptions.set(subscriptionKey, subscription);

  void pumpWatchSubscription(subscriptionKey, subscription, state.watchSubscriptions);

  return {
    watchId
  };
}

async function nextWatchEvent(
  watchSubscriptions: Map<string, WatchSubscription>,
  sessionId: string,
  watchId: string
): Promise<WatchRpcNextResult> {
  const subscriptionKey = getWatchSubscriptionKey(sessionId, watchId);
  const subscription = requireWatchSubscription(watchSubscriptions, sessionId, watchId);

  while (subscription.queue.length === 0 && !subscription.done && !subscription.error) {
    await new Promise<void>((resolve) => {
      subscription.waiting.push(resolve);
    });
  }

  if (subscription.error) {
    const error = subscription.error;
    await cleanupWatchSubscription(subscriptionKey, subscription, watchSubscriptions);
    throw error;
  }

  const event = subscription.queue.shift();
  if (event) {
    return {
      done: false,
      event
    };
  }

  await cleanupWatchSubscription(subscriptionKey, subscription, watchSubscriptions);
  return {
    done: true
  };
}

async function stopWatchSubscription(
  watchSubscriptions: Map<string, WatchSubscription>,
  sessionId: string,
  watchId: string
): Promise<{ stopped: true }> {
  const subscriptionKey = getWatchSubscriptionKey(sessionId, watchId);
  const subscription = watchSubscriptions.get(subscriptionKey);
  if (subscription) {
    await cleanupWatchSubscription(subscriptionKey, subscription, watchSubscriptions);
  }

  return {
    stopped: true
  };
}

async function pumpWatchSubscription(
  subscriptionKey: string,
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
    if (watchSubscriptions.get(subscriptionKey) === subscription) {
      subscription.done = true;
      flushWatchWaiters(subscription);
    }
  }
}

async function cleanupWatchSubscription(
  subscriptionKey: string,
  subscription: WatchSubscription,
  watchSubscriptions: Map<string, WatchSubscription>
): Promise<void> {
  if (watchSubscriptions.get(subscriptionKey) !== subscription) {
    return;
  }

  watchSubscriptions.delete(subscriptionKey);
  subscription.done = true;
  subscription.controller.abort();
  flushWatchWaiters(subscription);
  await subscription.iterator.return?.();
}

async function cleanupSessionWatchSubscriptions(
  sessionId: string,
  watchSubscriptions: Map<string, WatchSubscription>
): Promise<void> {
  const cleanupTasks: Promise<void>[] = [];

  for (const [subscriptionKey, subscription] of watchSubscriptions.entries()) {
    if (subscription.sessionId === sessionId) {
      cleanupTasks.push(cleanupWatchSubscription(subscriptionKey, subscription, watchSubscriptions));
    }
  }

  await Promise.all(cleanupTasks);
}

function requireWatchSubscription(
  watchSubscriptions: Map<string, WatchSubscription>,
  sessionId: string,
  watchId: string
): WatchSubscription {
  const subscription = watchSubscriptions.get(getWatchSubscriptionKey(sessionId, watchId));
  if (!subscription) {
    throw new Error(`RPC watch "${watchId}" was not found for session "${sessionId}".`);
  }

  return subscription;
}

function withSessionService<TResult>(
  state: RpcServerState,
  params: unknown,
  handler: (
    service: CobookService,
    params: Record<string, unknown> & { sessionId: string }
  ) => Promise<TResult> | TResult
): Promise<TResult> | TResult {
  const sessionParams = expectSessionParams(params);
  return handler(requireSessionService(state, sessionParams.sessionId), sessionParams);
}

function requireSessionService(state: RpcServerState, sessionId: string): CobookService {
  const managed = state.sessions.get(sessionId);
  if (!managed) {
    throw new Error(`RPC session "${sessionId}" was not found.`);
  }

  return managed.service;
}

function getWatchSubscriptionKey(sessionId: string, watchId: string): string {
  return `${sessionId}:${watchId}`;
}

function flushWatchWaiters(subscription: WatchSubscription): void {
  for (const wake of subscription.waiting.splice(0)) {
    wake();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
