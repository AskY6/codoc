// LLM client interface and ChatRunContext.
//
// These types form the boundary between the chat runtime and any
// concrete LLM provider. They are deliberately Anthropic-*shaped*
// (messages API with tool use) but do NOT import the Anthropic SDK.
// The only file that touches the SDK is `llm-adapter.ts`.
//
// ChatRunContext extends @cobook/graph's NodeContext<ChatEvent> with
// the `llm` capability. Agent `run()` implementations cast `ctx` to
// ChatRunContext (structural typing) to access the LLM client.

import type { MessageId } from "@cobook/core";
import type { NodeContext } from "@cobook/graph";
import type { ChatEvent } from "../state/events.js";

// ---- LLM message types --------------------------------------------------

export type LlmRole = "user" | "assistant";

export type LlmContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
    };

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string | readonly LlmContentBlock[];
}

// ---- LLM tool definition ------------------------------------------------

export interface LlmToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
}

// ---- LLM response -------------------------------------------------------

export type LlmResponseBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    };

export interface LlmResponse {
  readonly content: readonly LlmResponseBlock[];
  readonly stop_reason: string;
}

// ---- LLM client interface -----------------------------------------------

export interface LlmClient {
  createMessage(params: {
    readonly model: string;
    readonly maxTokens: number;
    readonly system: string;
    readonly messages: readonly LlmMessage[];
    readonly tools?: readonly LlmToolDef[];
  }): Promise<LlmResponse>;
}

// ---- Chat run context ---------------------------------------------------

/**
 * Extended context for chat-bound graph runs. Agents cast the
 * generic `NodeContext<ChatEvent>` they receive from the executor
 * to this interface (structural typing) to access the LLM client.
 *
 * The graph executor and @cobook/graph never see `ChatRunContext`
 * directly — they only know `NodeContext<E>`. This keeps the
 * framework layer vendor-neutral.
 */
export interface ModelConfig {
  readonly routerModel?: string | undefined;
  readonly defaultModel?: string | undefined;
}

/**
 * Confirmation gate callback. The tool loop calls this before
 * executing a tool that requires user approval. The implementation
 * (provided by the service layer) emits a `confirmationRequest` SSE
 * event and blocks until the user responds via POST /:id/confirm.
 *
 * Returns `true` to approve, `false` to deny.
 */
export type ConfirmToolFn = (
  tool: string,
  input: Readonly<Record<string, unknown>>,
) => Promise<boolean>;

export interface ChatRunContext extends NodeContext<ChatEvent> {
  readonly llm: LlmClient;
  readonly mintMessageId: () => MessageId;
  readonly modelConfig?: ModelConfig | undefined;
  readonly confirmTool?: ConfirmToolFn | undefined;
}
