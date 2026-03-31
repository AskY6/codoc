// Scene Agent — domain-layer agent protocol.
// Scene agents read schema, apply domain knowledge, and produce structured intents.

export interface IntentProposal {
  targetDocId: string;
  targetField?: string;
  /** Human-readable description of the intent */
  content: string;
  /** Structured payload — executor runs it directly when present */
  payload?: { kind: string; payload: unknown };
}

export interface SceneAgentResult {
  /** Text reply shown in chat */
  reply: string;
  /** Proposed intents to enqueue */
  proposals: IntentProposal[];
}

export interface SceneAgentContext {
  /** Schema of the target codoc(s) */
  schemas: Record<string, Record<string, unknown>>;
  /** Current data of the target codoc(s) */
  data: Record<string, Record<string, unknown>>;
  /** The user's message or trigger that activated this agent */
  userMessage: string;
  /** Recent conversation history (formatted text) */
  chatHistory: string;
  /** Additional context (referenced docs, connector catalog, etc.) */
  additionalContext?: string;
}

export interface SceneAgent {
  id: string;
  name: string;
  description: string;
  /** Optional: which kinds of codocs this agent can work with */
  targetCodocKinds?: string[];
  /** Whether this agent is trusted (intents skip human review) */
  trusted: boolean;
  /** Core method: read context, produce structured intents */
  handle(context: SceneAgentContext): Promise<SceneAgentResult>;
}

export interface SceneAgentEntry {
  agent: SceneAgent;
  active: boolean;
}
