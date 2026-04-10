// Codoc domain — structural definitions for the minimum knowledge unit.
// Pure types + a single pure ref parser/resolver. No IO, no framework.

// NOTE: `CodocId` etc. are merged type+value symbols — one export re-exports
// both the branded type and the smart constructor.
export { CodocId, CodocPath, FieldName, NodeId } from "./ids.js";

export type { CodocMeta, FieldSchema } from "./meta.js";
export type { DataField } from "./data.js";
export type { View } from "./view.js";
export type { CodocAST } from "./ast.js";
export type { Codoc } from "./codoc.js";
export type { ResolveError, ResolveResult, ResolvedField } from "./resolved.js";

export type { Ref, RefTarget, ParseRefError } from "./ref.js";
export { parseRef, resolveRef } from "./ref.js";
