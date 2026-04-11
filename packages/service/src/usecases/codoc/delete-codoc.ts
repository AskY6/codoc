// delete-codoc — remove a codoc by id.
//
// Slice 2 keeps `ThreadCodocStore` a stub, so there are never any
// referrers and the `CodocReferenced` arm is structurally unreachable
// in this slice. It is still listed on the error union because the
// service-level error ADT is stable across slices; the slice that
// ships the real thread-codoc store replaces the stub without
// touching this use case's signature.
//
// Single-store call; no transaction needed.

import type { CodocId, Result } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { CodocNotFound, CodocReferenced } from "../../errors.js";
import { codocRepo } from "../../repo/codoc.js";

export type DeleteCodocError = CodocNotFound | CodocReferenced;

export async function deleteCodoc(
  ctx: ServiceCtx,
  id: CodocId,
): Promise<Result<void, DeleteCodocError>> {
  return codocRepo.delete(ctx, id);
}
