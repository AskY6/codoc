import type { AgentId } from "./ids.js";

/**
 * Declarative agent record.
 *
 * This is NOT the runtime interface that exposes `run()`. It is the
 * persisted "here is an agent that exists" shape — enough to list,
 * register, or reference an agent. The runtime contract (message
 * streaming, tool use, etc.) belongs in a separate runtime package.
 */
export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
}
