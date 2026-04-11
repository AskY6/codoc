import type { AgentId, ChatMessage } from "@cobook/core";
import type { NodeId } from "../graph/ids.js";

/**
 * Events streamed out of a cobook-bound graph execution.
 *
 * The executor pipes every `CobookEvent` from a node's
 * `NodeContext.emit` callback to the caller's `onEvent` handler in
 * emission order. Downstream `@cobook/chat` (or any other consumer)
 * turns these into assistant-message deltas for the UI.
 *
 * Design notes:
 * - Tools are identified by a plain `string` here, not by the
 *   `ToolId` brand defined in `../tools/`. This keeps the
 *   dependency direction (`tools → cobook`) clean: `cobook/` never
 *   imports from `tools/`.
 * - The set of variants is intentionally small. Adding a new event
 *   kind = adding a new ADT variant (same rule as `ChatMessage` in
 *   `@cobook/core`).
 */
export type CobookEvent =
  | {
      readonly kind: "token";
      readonly nodeId: NodeId;
      readonly delta: string;
    }
  | {
      readonly kind: "toolCall";
      readonly nodeId: NodeId;
      readonly tool: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "toolResult";
      readonly nodeId: NodeId;
      readonly tool: string;
      readonly output: unknown;
    }
  | {
      readonly kind: "agentHandoff";
      readonly from: AgentId;
      readonly to: AgentId;
    }
  | {
      readonly kind: "done";
      readonly finalMessage: ChatMessage;
    };
