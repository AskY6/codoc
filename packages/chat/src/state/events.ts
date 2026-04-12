import type { AgentId, ChatMessage } from "@cobook/core";
import type { NodeId } from "@cobook/graph";

/**
 * Events streamed out of a single chat turn.
 *
 * The executor pipes every `ChatEvent` from a node's
 * `NodeContext.emit` callback to the caller's `onEvent` handler
 * in emission order. The runner in `../runner/` turns these into
 * assistant-message deltas for the UI.
 *
 * Design notes:
 * - Tools are identified by a plain `string` here, not by the
 *   `ToolId` brand from `@cobook/graph`. Rationale: tool ids are
 *   opaque to this union; we stream them through unchanged, and
 *   the tool layer owns the brand.
 * - The set of variants is intentionally small. Adding a new event
 *   kind = adding a new ADT variant (same rule as `ChatMessage` in
 *   `@cobook/core`).
 */
export type ChatEvent =
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
      readonly kind: "confirmationRequest";
      readonly requestId: string;
      readonly nodeId: NodeId;
      readonly tool: string;
      readonly input: Readonly<Record<string, unknown>>;
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
