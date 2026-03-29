import type {
  AgentHandler,
  Message,
  Participant,
  TriggerFilter,
} from "./types.js";

export interface BusConfig {
  maxChainDepth: number;
  cooldownMs: number;
}

const DEFAULT_CONFIG: BusConfig = {
  maxChainDepth: 3,
  cooldownMs: 1000,
};

/**
 * Determine which agent participants should be triggered by a message.
 * Pure function — no side effects, no executor calls.
 */
export function findTriggeredParticipants(
  message: Message,
  participants: Participant[],
): string[] {
  const triggered: string[] = [];

  for (const p of participants) {
    if (p.kind !== "agent") continue;

    const mode = p.responseMode;

    if (mode.type === "on-mention") {
      if (message.mentionedParticipants?.includes(p.id)) {
        triggered.push(p.id);
      }
    } else if (mode.type === "daemon") {
      if (matchesTriggerFilter(message, mode.filter)) {
        triggered.push(p.id);
      }
    }
    // "on-command" and "passive" — not triggered by normal messages
  }

  return triggered;
}

/**
 * Check if a message passes a daemon's TriggerFilter.
 */
export function matchesTriggerFilter(
  message: Message,
  filter: TriggerFilter,
): boolean {
  // All specified filters must match (AND logic).
  // An empty/unspecified filter field means "don't filter on this dimension".

  if (filter.fromParticipants && filter.fromParticipants.length > 0) {
    if (!filter.fromParticipants.includes(message.sender.id)) {
      return false;
    }
  }

  if (filter.resourceKinds && filter.resourceKinds.length > 0) {
    const msgKinds = message.resourceRefs?.map((r) => r.kind) ?? [];
    if (!filter.resourceKinds.some((k) => msgKinds.includes(k))) {
      return false;
    }
  }

  if (filter.intentKinds && filter.intentKinds.length > 0) {
    const msgIntentKinds = message.intents?.map((i) => i.kind) ?? [];
    if (!filter.intentKinds.some((k) => msgIntentKinds.includes(k))) {
      return false;
    }
  }

  if (filter.keywords && filter.keywords.length > 0) {
    const lower = message.content.toLowerCase();
    if (!filter.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return false;
    }
  }

  return true;
}

/**
 * ChatBus manages agent handler registration and response chain execution.
 */
export class ChatBus {
  private handlers = new Map<string, AgentHandler>();
  private lastResponseTime = new Map<string, number>();
  private config: BusConfig;

  constructor(config?: Partial<BusConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  registerHandler(participantId: string, handler: AgentHandler): void {
    this.handlers.set(participantId, handler);
  }

  getHandler(participantId: string): AgentHandler | undefined {
    return this.handlers.get(participantId);
  }

  /**
   * Process a message through the routing chain.
   * Returns all response messages produced by triggered agents.
   *
   * `dispatchReply` is called for each agent reply — the caller (ChatAbility)
   * provides this to wire replies back into the session + bus recursively.
   */
  async processMessage(
    message: Message,
    participants: Participant[],
    dispatchReply: (agentId: string, reply: Message) => Promise<void>,
    chainDepth: number = 0,
    triggeredInChain: Set<string> = new Set(),
  ): Promise<void> {
    if (chainDepth >= this.config.maxChainDepth) return;

    const triggered = findTriggeredParticipants(message, participants);

    for (const agentId of triggered) {
      // Dedup: same agent not triggered twice in one chain
      const dedupKey = `${agentId}:${message.id}`;
      if (triggeredInChain.has(dedupKey)) continue;
      triggeredInChain.add(dedupKey);

      // Cooldown: daemon agents have minimum interval
      const participant = participants.find((p) => p.id === agentId);
      if (participant?.responseMode.type === "daemon") {
        const lastTime = this.lastResponseTime.get(agentId) ?? 0;
        if (Date.now() - lastTime < this.config.cooldownMs) continue;
      }

      const handler = this.handlers.get(agentId);
      if (!handler) continue;

      // Context assembly is done by the caller before invoking handler.
      // Here we pass an empty context — the ChatAbility layer assembles
      // context and wraps the handler call.
      // This is handled in index.ts's wiring.
      await dispatchReply(agentId, message);
    }
  }

  recordResponse(agentId: string): void {
    this.lastResponseTime.set(agentId, Date.now());
  }

  isOnCooldown(agentId: string): boolean {
    const lastTime = this.lastResponseTime.get(agentId) ?? 0;
    return Date.now() - lastTime < this.config.cooldownMs;
  }

  getConfig(): BusConfig {
    return { ...this.config };
  }
}
