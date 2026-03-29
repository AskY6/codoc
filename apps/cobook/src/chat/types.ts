// Chat Ability — core type definitions.
// This layer knows nothing about codoc or any specific application domain.

export interface ParticipantRef {
  id: string;
  kind: "human" | "agent";
}

export interface Participant {
  id: string;
  kind: "human" | "agent";
  name: string;
  description: string;
  contextRequirements?: ContextRequirement[];
  responseMode: ResponseMode;
}

export interface ResourceRef {
  kind: string;
  id: string;
  label?: string;
}

export interface Intent {
  kind: string;
  payload: unknown;
  status: "proposed" | "confirmed" | "rejected";
}

export interface Message {
  id: string;
  sender: ParticipantRef;
  content: string;
  quotedIds?: string[];
  resourceRefs?: ResourceRef[];
  mentionedParticipants?: string[];
  intents?: Intent[];
  timestamp: number;
}

export type NewMessage = Omit<Message, "id" | "timestamp">;

// --- Context ---

export interface ContextRequirement {
  sourceKind: string;
  priority: "required" | "optional";
  maxTokens?: number;
}

export interface ContextData {
  kind: string;
  content: string;
  tokens?: number;
}

export interface ContextSource {
  kind: string;
  resolve(): Promise<ContextData>;
}

export interface ContextSourceFactory {
  kind: string;
  create(ref: ResourceRef): ContextSource;
}

// --- Agent Handler (executor callback, implemented by application layer) ---

export type AgentHandler = (
  context: ContextData[],
  triggerMessage: Message,
) => Promise<ResponseAction | null>;

// --- Trigger & Response ---

export type ResponseMode =
  | { type: "on-mention" }
  | { type: "on-command"; commandId: string }
  | { type: "daemon"; filter: TriggerFilter }
  | { type: "passive" };

export interface TriggerFilter {
  fromParticipants?: string[];
  resourceKinds?: string[];
  intentKinds?: string[];
  keywords?: string[];
}

export type ResponseAction =
  | { type: "reply"; message: NewMessage }
  | { type: "open-thread"; config: ThreadConfig; firstMessage?: NewMessage };

// --- Thread (types only; lifecycle comes in Phase 6) ---

export interface ThreadAnchor {
  parentMessageId: string;
  status: "open" | "resolved" | "abandoned";
  resolution?: { summary: string; intents?: Intent[] };
}

export interface ThreadConfig {
  inheritParticipants: boolean | string[];
  inheritContext: boolean | string[];
  additionalParticipants?: Participant[];
  additionalContextSources?: ContextSource[];
}

// --- Session ---

export interface MessageNode {
  message: Message;
  parentId: string | null;
  childIds: string[];
  threadId?: string;
}

export interface SessionConfig {
  id?: string;
}

// --- Events ---

export interface ChatEvents {
  onMessage: (msg: Message) => void;
  onIntentStatusChange: (
    msgId: string,
    intentIdx: number,
    status: Intent["status"],
  ) => void;
  onBranchSwitch: (activePath: string[]) => void;
  onParticipantJoin: (participant: Participant) => void;
  onParticipantLeave: (participantId: string) => void;
}

export type Unsubscribe = () => void;
