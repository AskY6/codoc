import type { WorkspaceService } from "@cobook/service";

// ---------------------------------------------------------------------------
// Chat events — yielded by agent.run() as an async iterable
// ---------------------------------------------------------------------------

export type ChatEvent =
  | { kind: "text-delta"; text: string }
  | { kind: "tool-use"; toolName: string; input: Record<string, unknown> }
  | { kind: "tool-result"; toolName: string; output: unknown }
  | { kind: "done"; fullText: string }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Agent context — everything the agent needs to operate
// ---------------------------------------------------------------------------

export interface AgentContext {
  workspaceId: string;
  service: WorkspaceService;
}

// ---------------------------------------------------------------------------
// Agent interface
// ---------------------------------------------------------------------------

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

export interface Agent {
  run(
    messages: AgentMessage[],
    ctx: AgentContext,
  ): AsyncIterable<ChatEvent>;
}
