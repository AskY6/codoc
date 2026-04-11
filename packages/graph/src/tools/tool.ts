import type { Result } from "@cobook/core";
import type { NodeContext } from "../graph/node.js";
import type { ToolId } from "./ids.js";

/**
 * Declarative tool metadata — the slice of a tool an LLM needs to
 * decide whether to call it. No runtime behaviour here; see
 * `Tool.execute` for the callable side.
 */
export interface ToolSchema {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  /**
   * JSON schema for the tool's input, stored as an opaque object.
   * The graph layer does not validate or interpret this schema; it
   * is forwarded verbatim to the LLM client.
   */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * Structured failure modes a tool execution can surface. Anything
 * else (network errors, panics) bubbles out of `execute` as a
 * thrown value and is translated by the executor into a
 * `RunGraphError.nodeThrew` variant.
 */
export type ToolError =
  | { readonly kind: "invalidInput"; readonly message: string }
  | { readonly kind: "execution"; readonly message: string };

/**
 * A runtime tool, generic over the graph's state `S` and event `E`.
 *
 * This package owns the contract only; it does not pick `S` / `E`.
 * Concrete applications bind them — e.g. `@cobook/chat` exports
 * `ChatTool = Tool<ChatState, ChatEvent>` so downstream code
 * never has to write the generics out.
 *
 * The tool receives the raw `input` object the LLM produced (still
 * `unknown` — the tool is responsible for parsing it against its
 * own `schema.inputSchema`), the current state `S`, and the
 * surrounding `NodeContext<E>` so it can emit progress events.
 *
 * Tools are **pure w.r.t. state**: they do not mutate the state
 * object, they only return `Result`-wrapped output. Any state
 * delta a tool wants to contribute is applied by the agent node
 * that called it, not by the tool itself.
 */
export interface Tool<S, E> {
  readonly schema: ToolSchema;
  readonly execute: (
    input: unknown,
    state: S,
    ctx: NodeContext<E>,
  ) => Promise<Result<unknown, ToolError>>;
}
