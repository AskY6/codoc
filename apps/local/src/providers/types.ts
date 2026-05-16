// providers/types — Unified chat provider interface.
//
// Every CLI backend (Claude Code, Codex, Kiro) implements ChatProvider.
// The chat route delegates to whichever provider the conversation uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "../domain/types.js";
import type { WorkspacePlugin, WorkspacePluginContext } from "../plugins/types.js";

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
  /** Active workspace plugin (used to source plugin-contributed agent instructions). */
  plugin?: WorkspacePlugin<unknown> | undefined;
  /** Plugin runtime context — required for getAgentInstructions hook invocation. */
  pluginCtx?: WorkspacePluginContext<unknown> | undefined;
  /** Mentioned codoc paths (already normalized to .codoc) */
  mentions?: string[] | undefined;
  /** Base64 image attachments */
  images?: { dataUrl: string; name: string }[] | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Resolve the agent instruction blob for a workspace.
 *
 * Composition: plugin prefix (from `plugin.getAgentInstructions(ctx)`)
 *              + config suffix (from `codoc.config.json.agentInstructions`).
 *
 * Both are optional; if both are present they're joined by a blank line so the
 * user-level config can override or extend the plugin baseline.
 */
export function readAgentInstructions(
  workspace: Workspace,
  plugin?: WorkspacePlugin<unknown>,
  pluginCtx?: WorkspacePluginContext<unknown>,
): string | undefined {
  const pluginPart =
    plugin?.getAgentInstructions && pluginCtx
      ? plugin.getAgentInstructions(pluginCtx)
      : undefined;

  let configPart: string | undefined;
  try {
    const raw = readFileSync(join(workspace.sourceDir, "codoc.config.json"), "utf-8");
    const cfg = JSON.parse(raw) as { agentInstructions?: string };
    configPart = cfg.agentInstructions ?? undefined;
  } catch {
    configPart = undefined;
  }

  // Defensive dedup: workspaces scaffolded before the plugin hook landed have
  // the plugin's baseline already copied into config — treat that as no override.
  if (pluginPart && configPart && pluginPart.trim() === configPart.trim()) {
    return pluginPart;
  }

  if (pluginPart && configPart) return `${pluginPart}\n\n${configPart}`;
  return pluginPart ?? configPart;
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
