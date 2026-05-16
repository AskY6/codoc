// @cobook/parser — codoc boundary parser + source provider infrastructure.
//
// Shared by both product lines:
//   - apps/local  (local-first CLI)
//   - apps/server (server/web platform)
//
// Dependencies: @cobook/core (domain types), yaml (frontmatter parsing).

export { parseCodoc } from "./parse-codoc.js";
export type { ParseError } from "./parse-codoc.js";

export type { SourceProvider, SourceRegistry, MergeContext } from "./source.js";

export { createSourceRegistry } from "./registry.js";
