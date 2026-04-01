import type { CobookRpcServer } from "./create-cobook-rpc-server.js";
import type { ServiceRpcRequest, ServiceRpcResponse, ServiceTransport } from "./types.js";

export function createLoopbackServiceTransport(server: CobookRpcServer): ServiceTransport {
  return {
    send<TResult = unknown>(request: ServiceRpcRequest): Promise<ServiceRpcResponse<TResult>> {
      return server.handle(request) as Promise<ServiceRpcResponse<TResult>>;
    }
  };
}
