export type ServiceRpcMethod =
  | "openWorkspace"
  | "closeWorkspace"
  | "getWorkspace"
  | "build"
  | "rebuildCodoc"
  | "listCodocs"
  | "readCodoc"
  | "writeCodoc"
  | "invalidate"
  | "resolve"
  | "graph"
  | "diagnostics"
  | "chat"
  | "readAgentSession"
  | "writeAgentSession"
  | "clearAgentSession"
  | "watchStart"
  | "watchNext"
  | "watchStop";

export interface ServiceRpcRequest {
  id: string;
  method: ServiceRpcMethod;
  params?: unknown;
}

export interface ServiceRpcSuccess<TResult = unknown> {
  id: string;
  ok: true;
  result: TResult;
}

export interface ServiceRpcFailure {
  id: string;
  ok: false;
  error: {
    message: string;
  };
}

export type ServiceRpcResponse<TResult = unknown> =
  | ServiceRpcSuccess<TResult>
  | ServiceRpcFailure;

export interface ServiceTransport {
  send<TResult = unknown>(request: ServiceRpcRequest): Promise<ServiceRpcResponse<TResult>>;
}

export interface ClosableServiceTransport extends ServiceTransport {
  close(): Promise<void>;
}

export interface WatchRpcEventResult {
  done: false;
  event: unknown;
}

export interface WatchRpcDoneResult {
  done: true;
}

export type WatchRpcNextResult = WatchRpcEventResult | WatchRpcDoneResult;
