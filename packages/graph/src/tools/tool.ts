import type { Result } from "@cobook/core";
import type { CobookEvent } from "../cobook/events.js";
import type { CobookState } from "../cobook/state.js";
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
 * A runtime tool bound to the cobook state shape.
 *
 * The tool receives the raw `input` object the LLM produced (still
 * `unknown` — the tool is responsible for parsing it against its
 * own `schema.inputSchema`), the current `CobookState`, and the
 * surrounding `NodeContext` so it can emit progress events.
 *
 * Tools are **pure w.r.t. state**: they do not mutate the state
 * object, they only return `Result`-wrapped output. Any state
 * delta a tool wants to contribute is applied by the agent node
 * that called it, not by the tool itself.
 */
export interface Tool {
  readonly schema: ToolSchema;
  readonly execute: (
    input: unknown,
    state: CobookState,
    ctx: NodeContext<CobookEvent>,
  ) => Promise<Result<unknown, ToolError>>;
}
