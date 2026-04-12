// update-codoc-content — overwrite a codoc's raw `content` with
// optimistic concurrency.
//
// Slice 3 is the first slice to run a "non-trivial document" through
// the Rev / Conflict pipeline. The use case:
//
//   1. Reads the current `Codoc` to preserve its `ast.meta` /
//      `ast.data` / `ast.view` — the editor only touches `content`,
//      and without an MDX parser in the service layer we cannot
//      re-derive the ast from the new source. The ast therefore
//      round-trips unchanged. The slice that introduces the parser
//      will re-parse the ast here and rebuild the workspace DAG.
//   2. Calls `codocRepo.update` with the same `expectedRev` the
//      client handed back, returning the refreshed `CodocDetail`.
//
// Single-store write; no transaction needed. Only `create*` use cases
// mint ids, so `ctx.idGen` is untouched — same rule as
// `updateWorkspace`, which this use case is a direct copy of modulo
// the aggregate.

import type { Codoc, CodocId, Result } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { CodocConflict, CodocNotFound } from "../../errors.js";
import { codocRepo } from "../../repo/codoc.js";
import type { CodocDetail } from "../../types/codoc.js";

export interface UpdateCodocContentInput {
  readonly id: CodocId;
  readonly content: string;
  readonly expectedRev: string;
}

export type UpdateCodocContentError = CodocNotFound | CodocConflict;

export async function updateCodocContent(
  ctx: ServiceCtx,
  input: UpdateCodocContentInput,
): Promise<Result<CodocDetail, UpdateCodocContentError>> {
  const current = await codocRepo.getCodoc(ctx, input.id);
  if (!current.ok) return current;

  const next: Codoc = { ...current.value, content: input.content };
  return codocRepo.update(ctx, {
    codoc: next,
    expectedRev: input.expectedRev,
  });
}
