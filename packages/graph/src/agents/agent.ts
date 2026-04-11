import type { AgentId } from "@cobook/core";
import type { GraphNode } from "../graph/node.js";
import type { Tool } from "../tools/tool.js";
import type { ModelId } from "./ids.js";

/**
 * Runtime `Agent` interface — the one that actually plugs into the
 * graph executor. An Agent is a specific kind of `GraphNode`: one
 * driven by an LLM, with a system prompt and a bound set of tools.
 *
 * Generic over the graph's state `S` and event `E`. This package
 * owns the contract only; it does not pick `S` / `E`. Concrete
 * applications bind them — e.g. `@cobook/chat` exports
 * `ChatAgent = Agent<ChatState, ChatEvent>`.
 *
 * This is **not** the declarative directory record. The directory
 * record (`AgentListing`) lives in `@cobook/core/cobook/agent.ts`
 * and carries only id + name + description — enough to list agents
 * without pulling in runtime machinery.
 *
 * An Agent carries its `AgentId` as the `GraphNode.id` slot (note
 * the third type parameter of `GraphNode`), so the executor
 * treats it like any other node while callers keep the
 * type-level guarantee that "agent ids are agents".
 */
export interface Agent<S, E>
  extends GraphNode<S, E, AgentId> {
  /** Human-readable name; matches the `AgentListing.name` in core. */
  readonly name: string;

  /** Human-readable purpose; matches `AgentListing.description`. */
  readonly description: string;

  /** Which LLM this agent runs on. Opaque to this package. */
  readonly model: ModelId;

  /**
   * System prompt / persona. The full string handed to the LLM on
   * every turn, before the running `messages`. Not composed with
   * anything else at this layer — if you need templating, do it
   * before constructing the agent.
   */
  readonly systemPrompt: string;

  /**
   * Tools this agent may call. The set is closed at construction
   * time and immutable thereafter; adding a tool means building a
   * new Agent instance. A router-style agent with no tools uses
   * `[]`.
   */
  readonly tools: readonly Tool<S, E>[];
}
