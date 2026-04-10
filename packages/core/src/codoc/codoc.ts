import type { CodocAST } from "./ast.js";
import type { CodocId, CodocPath } from "./ids.js";

/**
 * Canonical in-memory codoc entity.
 *
 * A Codoc is *always* parsed — `ast` is a required field. Raw, unparsed
 * bytes are not a Codoc; they are an input to the parser. On parse
 * failure, callers receive an error instead of a half-built entity.
 *
 * `content` is retained alongside `ast` because agents and the UI edit
 * the source form, while pure core logic reads the ast.
 */
export interface Codoc {
  readonly id: CodocId;
  readonly path: CodocPath;
  readonly content: string;
  readonly ast: CodocAST;
}
