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
  operationTail: Promise<void>;
  sharedWatch: SharedWorkspaceWatch | null;
}

interface SharedWorkspaceWatch {
  managed: ManagedWorkspaceSession;
  controller: AbortController;
  iterator: AsyncIterator<WorkspaceWatchEvent>;
  subscriptions: Map<string, WatchSubscription>;
  closing: Promise<void> | null;
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
  sharedWatch: SharedWorkspaceWatch;
  queue: WorkspaceWatchEvent[];
  waiting: Array<() => void>;
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
      return withManagedSession(state, request.params, (managed) => managed.service.getWorkspace());
    case "build":
      return withManagedSession(state, request.params, (managed) => managed.service.build());
    case "rebuildCodoc":
      return withManagedSession(state, request.params, (managed, params) =>
        managed.service.rebuildCodoc(expectObjectWithString(params, "codocId"))
      );
    case "listCodocs":
      return withManagedSession(state, request.params, (managed) => managed.service.listCodocs());
    case "readCodoc":
      return withManagedSession(state, request.params, (managed, params) =>
        managed.service.readCodoc(expectObjectWithString(params, "codocId"))
      );
    case "writeCodoc":
      return withManagedSession(state, request.params, (managed, params) =>
        managed.service.writeCodoc(expectWriteInput(params))
      );
    case "invalidate":
      return withManagedSession(state, request.params, (managed, params) =>
        managed.service.invalidate(expectObjectWithString(params, "node"))
      );
    case "resolve":
      return withManagedSession(state, request.params, (managed, params) =>
        managed.service.resolve(expectObjectWithString(params, "node"))
      );
    case "graph":
      return withManagedSession(state, request.params, (managed) => managed.service.graph());
    case "diagnostics":
      return withManagedSession(state, request.params, (managed) => managed.service.diagnostics());
    case "chat":
      return withManagedSession(state, request.params, (managed, params) =>
        collectEvents(managed.service.chat(expectChatInput(params)))
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
      clientIds: new Set(),
      operationTail: Promise.resolve(),
      sharedWatch: null
    };
    state.workspaces.set(workspaceKey, managed);
  } else {
    const existing = managed;
    workspace = await runManagedOperation(existing, () => existing.service.getWorkspace());
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

    if (managed.sharedWatch) {
      await shutdownSharedWatch(managed.sharedWatch);
    }

    await runManagedOperation(managed, () => managed.service.closeWorkspace());
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
    ...(typeof params.agentId === "string" ? { agentId: params.agentId } : {}),
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

  const managed = requireManagedSession(state, sessionId);
  const sharedWatch = ensureSharedWatch(managed, state.watchSubscriptions);
  const subscription: WatchSubscription = {
    sessionId,
    sharedWatch,
    queue: [],
    waiting: [],
    done: false,
    error: null
  };

  sharedWatch.subscriptions.set(subscriptionKey, subscription);
  state.watchSubscriptions.set(subscriptionKey, subscription);

  return {
    watchId
  };
}

function ensureSharedWatch(
  managed: ManagedWorkspaceSession,
  watchSubscriptions: Map<string, WatchSubscription>
): SharedWorkspaceWatch {
  if (managed.sharedWatch) {
    return managed.sharedWatch;
  }

  const controller = new AbortController();
  const sharedWatch: SharedWorkspaceWatch = {
    managed,
    controller,
    iterator: managed.service.watch(controller.signal)[Symbol.asyncIterator](),
    subscriptions: new Map(),
    closing: null
  };
  managed.sharedWatch = sharedWatch;

  void pumpSharedWatch(sharedWatch, watchSubscriptions);

  return sharedWatch;
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

async function pumpSharedWatch(
  sharedWatch: SharedWorkspaceWatch,
  watchSubscriptions: Map<string, WatchSubscription>
): Promise<void> {
  try {
    while (true) {
      const next = await sharedWatch.iterator.next();
      if (next.done) {
        markSharedWatchDone(sharedWatch);
        return;
      }

      for (const subscription of sharedWatch.subscriptions.values()) {
        subscription.queue.push(next.value);
        flushWatchWaiters(subscription);
      }
    }
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    if (sharedWatch.subscriptions.size === 0) {
      return;
    }

    for (const subscription of sharedWatch.subscriptions.values()) {
      subscription.error = normalizedError;
      flushWatchWaiters(subscription);
    }
  } finally {
    if (sharedWatch.managed.sharedWatch === sharedWatch) {
      sharedWatch.managed.sharedWatch = null;
    }

    for (const [subscriptionKey, subscription] of sharedWatch.subscriptions.entries()) {
      if (watchSubscriptions.get(subscriptionKey) === subscription && !subscription.error) {
        subscription.done = true;
        flushWatchWaiters(subscription);
      }
    }
  }
}

function markSharedWatchDone(sharedWatch: SharedWorkspaceWatch): void {
  for (const subscription of sharedWatch.subscriptions.values()) {
    subscription.done = true;
    flushWatchWaiters(subscription);
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
  subscription.sharedWatch.subscriptions.delete(subscriptionKey);
  subscription.done = true;
  flushWatchWaiters(subscription);

  if (
    subscription.sharedWatch.subscriptions.size === 0 &&
    subscription.sharedWatch.managed.sharedWatch === subscription.sharedWatch
  ) {
    await shutdownSharedWatch(subscription.sharedWatch);
  }
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

function withManagedSession<TResult>(
  state: RpcServerState,
  params: unknown,
  handler: (
    managed: ManagedWorkspaceSession,
    params: Record<string, unknown> & { sessionId: string }
  ) => Promise<TResult> | TResult
): Promise<TResult> {
  const sessionParams = expectSessionParams(params);
  const managed = requireManagedSession(state, sessionParams.sessionId);
  return runManagedOperation(managed, () => handler(managed, sessionParams));
}

function requireManagedSession(state: RpcServerState, sessionId: string): ManagedWorkspaceSession {
  const managed = state.sessions.get(sessionId);
  if (!managed) {
    throw new Error(`RPC session "${sessionId}" was not found.`);
  }

  return managed;
}

function runManagedOperation<TResult>(
  managed: ManagedWorkspaceSession,
  operation: () => Promise<TResult> | TResult
): Promise<TResult> {
  const task = managed.operationTail.then(() => operation());
  managed.operationTail = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

async function shutdownSharedWatch(sharedWatch: SharedWorkspaceWatch): Promise<void> {
  if (sharedWatch.closing) {
    await sharedWatch.closing;
    return;
  }

  sharedWatch.closing = (async () => {
    if (sharedWatch.managed.sharedWatch === sharedWatch) {
      sharedWatch.managed.sharedWatch = null;
    }

    sharedWatch.controller.abort();
    await sharedWatch.iterator.return?.();
  })();

  await sharedWatch.closing;
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
