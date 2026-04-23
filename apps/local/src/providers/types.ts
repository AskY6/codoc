// providers/types — Unified chat provider interface.
//
// Every CLI backend (Claude Code, Codex, Kiro) implements ChatProvider.
// The chat route delegates to whichever provider the conversation uses.

import type { Workspace } from "../workspace.js";

// ---------------------------------------------------------------------------
// Unified event envelope — sent to the browser over SSE
// ---------------------------------------------------------------------------

export type ChatEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; name: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result?: string; costUsd?: number };

// ---------------------------------------------------------------------------
// Session history (for resume)
// ---------------------------------------------------------------------------

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: { name: string; status: "done" }[];
}

// ---------------------------------------------------------------------------
// Provider info (exposed to UI via GET /api/providers)
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
}

// ---------------------------------------------------------------------------
// ChatProvider — the adapter contract
// ---------------------------------------------------------------------------

export interface ChatParams {
  prompt: string;
  sessionId?: string | undefined;
  workspace: Workspace;
  /** Mentioned codoc paths (already normalized to .codoc) */
  mentions?: string[] | undefined;
  /** Base64 image attachments */
  images?: { dataUrl: string; name: string }[] | undefined;
  signal?: AbortSignal | undefined;
}

export interface ChatProvider {
  readonly id: string;
  readonly name: string;

  /** Check whether the CLI binary is installed locally. */
  detect(): Promise<boolean>;

  /** Stream a conversation turn, yielding unified ChatEvent envelopes. */
  chat(params: ChatParams): AsyncIterable<ChatEvent>;

  /** Read session history for resume display. */
  readHistory(sessionId: string, cwd: string): Promise<SessionMessage[]>;
}
