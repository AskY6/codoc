// update-codoc-content — overwrite a codoc's raw `content` with
// optimistic concurrency, re-parsing the AST from the new source.
//
// The boundary parser runs on every update so that `ast.meta`,
// `ast.data`, and `ast.view` always reflect the current `content`.

import type { Codoc, CodocId, Result } from "@cobook/core";
import { err } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type {
  CodocConflict,
  CodocNotFound,
  CodocParseFailure,
} from "../../errors.js";
import { parseCodoc } from "../../parser/index.js";
import { codocRepo } from "../../repo/codoc.js";
import type { CodocDetail } from "../../types/codoc.js";

export interface UpdateCodocContentInput {
  readonly id: CodocId;
  readonly content: string;
  readonly expectedRev: string;
}

export type UpdateCodocContentError =
  | CodocNotFound
  | CodocConflict
  | CodocParseFailure;

export async function updateCodocContent(
  ctx: ServiceCtx,
  input: UpdateCodocContentInput,
): Promise<Result<CodocDetail, UpdateCodocContentError>> {
  const current = await codocRepo.getCodoc(ctx, input.id);
  if (!current.ok) return current;

  // Re-parse AST from the new content.
  const parsed = parseCodoc(input.content);
  if (!parsed.ok) {
    return err({
      kind: "codoc-parse-failure",
      message: parsed.error.kind === "invalid-ref"
        ? `${parsed.error.kind}: ${parsed.error.field} → ${parsed.error.input}`
        : `${parsed.error.kind}: ${parsed.error.message}`,
    });
  }

  const next: Codoc = {
    ...current.value,
    content: input.content,
    ast: parsed.value,
  };
  return codocRepo.update(ctx, {
    codoc: next,
    expectedRev: input.expectedRev,
  });
}
