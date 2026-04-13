// get-codoc — return a single codoc as the detail DTO.
//
// Powers the `/workspace/:id/codoc/:codocId` page. Shape symmetry with
// `getWorkspace`: a single-store read that returns the same envelope
// the editor binds to, so cache hydration from a future list-detail
// prefetch is trivial.

import type { CodocId, Result } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { CodocNotFound } from "../../errors.js";
import { codocRepo } from "../../repo/codoc.js";
import type { CodocDetail } from "../../types/codoc.js";

export type GetCodocError = CodocNotFound;

export async function getCodoc(
  ctx: ServiceCtx,
  id: CodocId,
): Promise<Result<CodocDetail, GetCodocError>> {
  return codocRepo.getDetailResolved(ctx, id);
}
