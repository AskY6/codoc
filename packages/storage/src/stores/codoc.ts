import type { Codoc, CodocId, Result, WorkspaceId } from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type {
  AlreadyExists,
  CodocReferenced,
  Conflict,
  NotFound,
} from "../errors.js";
import type { Rev } from "../meta.js";
import type { StoredCodoc } from "../stored.js";

export interface CreateCodocInput {
  readonly codoc: Codoc;
  readonly workspaceId: WorkspaceId;
}

export interface UpdateCodocInput {
  readonly codoc: Codoc;
  readonly expectedRev: Rev;
}

/**
 * Persistent store of codocs.
 *
 * Ownership: every codoc belongs to exactly one workspace, recorded on
 * `StoredCodoc.workspaceId`. A codoc may only be referenced by threads
 * within that same workspace (see `ThreadCodocStore`).
 *
 * Concurrency: `update` takes an `expectedRev`; on mismatch it returns
 * `Conflict<"codoc">` and the store's state is unchanged. There is no
 * built-in retry — services surface the conflict to the caller.
 *
 * Deletion: `delete` refuses with `CodocReferenced` if any
 * `ThreadCodoc` still points at the codoc. Callers must unlink every
 * referrer first and then retry.
 */
export interface CodocStore {
  get(
    ctx: Ctx,
    id: CodocId,
  ): Promise<Result<StoredCodoc, NotFound<"codoc">>>;

  listByWorkspace(
    ctx: Ctx,
    workspaceId: WorkspaceId,
  ): Promise<readonly StoredCodoc[]>;

  create(
    ctx: Ctx,
    input: CreateCodocInput,
  ): Promise<
    Result<StoredCodoc, AlreadyExists<"codoc"> | NotFound<"workspace">>
  >;

  update(
    ctx: Ctx,
    input: UpdateCodocInput,
  ): Promise<
    Result<StoredCodoc, NotFound<"codoc"> | Conflict<"codoc">>
  >;

  delete(
    ctx: Ctx,
    id: CodocId,
  ): Promise<Result<void, NotFound<"codoc"> | CodocReferenced>>;
}
