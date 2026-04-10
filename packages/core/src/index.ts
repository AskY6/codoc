// @cobook/core — domain types and pure logic for the cobook platform.
//
// Three submodules, each with a single responsibility:
//   codoc  — structural definitions for the knowledge unit
//   dag    — field-level dependency graph built over codocs
//   cobook — collaboration layer: workspace, agent, chat
//
// Import direction is strictly inward:
//   dag    → codoc
//   cobook → codoc (ids only)
//   codoc  → (nothing)
//
// Core never touches IO, framework, database, or network.

// ---- shared utilities ---------------------------------------------------
export type { Result, Brand } from "./shared/index.js";
export { ok, err, isOk, isErr } from "./shared/index.js";

// ---- codoc domain -------------------------------------------------------
export * from "./codoc/index.js";

// ---- dag ----------------------------------------------------------------
export * from "./dag/index.js";

// ---- cobook domain ------------------------------------------------------
export * from "./cobook/index.js";
