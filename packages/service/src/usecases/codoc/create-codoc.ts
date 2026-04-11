// create-codoc — mint a fresh codoc inside a workspace.
//
// The use case owns the id: transports supply `{ workspaceId, path,
// title }` and the service mints the `CodocId` via
// `ctx.idGen.codocId()`. Letting an untrusted client choose its own
// primary key is a security hazard — see the usecases AGENTS.md.
//
// Slice 2 builds a minimal `Codoc` with an empty AST directly here,
// rather than piping the input through an MDX parser. This keeps the
// parser out of the service layer: codocs start life as "title-only"
// entries and pick up content when the detail page (slice 3) ships
// the editor. The empty shape is a deliberate choice, documented in
// `./AGENTS.md`.

import type {
  Codoc,
  CodocId,
  CodocPath,
  DataField,
  FieldName,
  FieldSchema,
  Result,
  WorkspaceId,
} from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { CodocAlreadyExists, WorkspaceNotFound } from "../../errors.js";
import { codocRepo } from "../../repo/codoc.js";
import type { CodocListItem } from "../../types/codoc.js";

export interface CreateCodocInput {
  readonly workspaceId: WorkspaceId;
  readonly path: string;
  readonly title: string | null;
}

export type CreateCodocError = CodocAlreadyExists | WorkspaceNotFound;

export async function createCodoc(
  ctx: ServiceCtx,
  input: CreateCodocInput,
): Promise<Result<CodocListItem, CreateCodocError>> {
  const id: CodocId = ctx.idGen.codocId();
  const codoc: Codoc = {
    id,
    path: input.path as CodocPath,
    content: "",
    ast: {
      meta: {
        title: input.title,
        description: null,
        tags: [],
        schema: new Map<FieldName, FieldSchema>() as ReadonlyMap<
          FieldName,
          FieldSchema
        >,
      },
      data: new Map<FieldName, DataField>() as ReadonlyMap<
        FieldName,
        DataField
      >,
      view: { kind: "empty" },
    },
  };
  return codocRepo.create(ctx, { codoc, workspaceId: input.workspaceId });
}
