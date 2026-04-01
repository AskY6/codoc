import type { NodeKey } from "../ids/node-id.js";

export interface NodeState {
  status: "idle" | "computing" | "ready" | "error" | "dirty";
  version: number;
  value: unknown;
  error: Error | null;
}

export interface ResolveOptions {
  force?: boolean;
  signal?: AbortSignal;
}

export interface RuntimeContext {
  states: Map<NodeKey, NodeState>;
}

export function createRuntimeContext(): RuntimeContext {
  return {
    states: new Map()
  };
}
