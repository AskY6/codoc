import type { AgentHandler } from "./types.js";

/**
 * HandlerRegistry — simple agent handler storage.
 *
 * The routing decision is made by the application layer (NLRouter),
 * not by the bus. The bus only stores and retrieves handlers.
 */
export class HandlerRegistry {
  private handlers = new Map<string, AgentHandler>();
  private lastResponseTime = new Map<string, number>();

  register(participantId: string, handler: AgentHandler): void {
    this.handlers.set(participantId, handler);
  }

  get(participantId: string): AgentHandler | undefined {
    return this.handlers.get(participantId);
  }

  recordResponse(participantId: string): void {
    this.lastResponseTime.set(participantId, Date.now());
  }
}
