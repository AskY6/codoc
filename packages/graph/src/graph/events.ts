/**
 * `graph/` is generic in its event type `E`. The executor knows only
 * how to pipe `E`-shaped values from a node's `NodeContext.emit`
 * callback to the caller-supplied `onEvent` handler. It does not
 * impose any structure on `E`.
 *
 * Concrete event unions — e.g. `ChatEvent` with `token` /
 * `toolCall` / `done` variants — are defined downstream in
 * `@cobook/chat`. This file intentionally contains no runtime
 * types; it exists so that future generic event helpers have a
 * home that still belongs to `graph/`.
 */
export {};
