export type ServiceRpcMethod =
  | "openWorkspace"
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
  | "chat";

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
