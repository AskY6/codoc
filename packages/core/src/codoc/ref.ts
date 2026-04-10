import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import type { CodocPath, FieldName, NodeId } from "./ids.js";
import {
  CodocPath as mkCodocPath,
  FieldName as mkFieldName,
  NodeId as mkNodeId,
} from "./ids.js";

// ---------------------------------------------------------------------------
// Ref — a typed pointer from one codoc field to another.
// ---------------------------------------------------------------------------

/**
 * How the target codoc is addressed.
 *
 * - `relative` paths begin with "./" or "../" and are resolved against the
 *   source codoc's directory.
 * - `absolute` paths are already workspace-root-relative.
 */
export type RefTarget =
  | { readonly kind: "relative"; readonly path: string }
  | { readonly kind: "absolute"; readonly path: CodocPath };

/**
 * A structured reference. `field` is the leaf name under the target
 * codoc's `data` block — i.e. the `"summary"` in `data.summary`.
 */
export interface Ref {
  readonly target: RefTarget;
  readonly field: FieldName;
}

// ---------------------------------------------------------------------------
// Ref parsing
//
// Wire format: `<path>#data.<fieldName>`
// Example:     `./other.codoc#data.summary`
// ---------------------------------------------------------------------------

export type ParseRefError =
  | { readonly kind: "missing-hash"; readonly input: string }
  | { readonly kind: "empty-path"; readonly input: string }
  | { readonly kind: "empty-field"; readonly input: string }
  | { readonly kind: "non-data-field"; readonly input: string; readonly field: string };

export function parseRef(input: string): Result<Ref, ParseRefError> {
  const hashIndex = input.indexOf("#");
  if (hashIndex === -1) {
    return err({ kind: "missing-hash", input });
  }

  const pathPart = input.slice(0, hashIndex);
  const fieldPart = input.slice(hashIndex + 1);

  if (!pathPart) return err({ kind: "empty-path", input });
  if (!fieldPart) return err({ kind: "empty-field", input });

  // Only data fields are referenceable for now.
  if (!fieldPart.startsWith("data.")) {
    return err({ kind: "non-data-field", input, field: fieldPart });
  }

  const leaf = fieldPart.slice("data.".length);
  if (!leaf) return err({ kind: "empty-field", input });

  const target: RefTarget =
    pathPart.startsWith("./") || pathPart.startsWith("../")
      ? { kind: "relative", path: pathPart }
      : { kind: "absolute", path: mkCodocPath(pathPart) };

  return ok({ target, field: mkFieldName(leaf) });
}

// ---------------------------------------------------------------------------
// Ref resolution — pure, no IO. Produces a canonical NodeId.
// ---------------------------------------------------------------------------

/**
 * Resolve a structured ref against the path of the codoc that contains it,
 * producing a fully-qualified NodeId for the target field.
 */
export function resolveRef(ref: Ref, baseCodocPath: CodocPath): NodeId {
  const targetPath =
    ref.target.kind === "absolute"
      ? ref.target.path
      : mkCodocPath(joinRelative(dirname(baseCodocPath), ref.target.path));

  return mkNodeId(`${targetPath}#data.${ref.field}`);
}

// ---------------------------------------------------------------------------
// Internal path helpers — posix-style only. Core never touches node:path.
// ---------------------------------------------------------------------------

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function joinRelative(baseDir: string, relative: string): string {
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of relative.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}
