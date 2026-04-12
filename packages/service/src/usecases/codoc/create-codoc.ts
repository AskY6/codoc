// create-codoc — mint a fresh codoc inside a workspace.
//
// The use case owns the id: transports supply `{ workspaceId, path,
// title }` and the service mints the `CodocId` via
// `ctx.idGen.codocId()`. Letting an untrusted client choose its own
// primary key is a security hazard — see the usecases AGENTS.md.
//
// When `content` is supplied, it is parsed into a full AST via the
// boundary parser. When omitted, an empty AST is built from `title`.

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
import { err } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type {
  CodocAlreadyExists,
  CodocParseFailure,
  WorkspaceNotFound,
} from "../../errors.js";
import { parseCodoc } from "../../parser/index.js";
import { codocRepo } from "../../repo/codoc.js";
import type { CodocListItem } from "../../types/codoc.js";

export interface CreateCodocInput {
  readonly workspaceId: WorkspaceId;
  readonly path: string;
  readonly title: string | null;
  readonly content?: string;
}

export type CreateCodocError =
  | CodocAlreadyExists
  | CodocParseFailure
  | WorkspaceNotFound;

export async function createCodoc(
  ctx: ServiceCtx,
  input: CreateCodocInput,
): Promise<Result<CodocListItem, CreateCodocError>> {
  const id: CodocId = ctx.idGen.codocId();

  // When content is supplied, parse it into a full AST.
  if (input.content) {
    const parsed = parseCodoc(input.content);
    if (!parsed.ok) {
      return err({
        kind: "codoc-parse-failure",
        message: parsed.error.kind === "invalid-ref"
          ? `${parsed.error.kind}: ${parsed.error.field} → ${parsed.error.input}`
          : `${parsed.error.kind}: ${parsed.error.message}`,
      });
    }

    // If parser extracted a title, use it; otherwise fall back to input.title.
    const ast = parsed.value;
    const codoc: Codoc = {
      id,
      path: input.path as CodocPath,
      content: input.content,
      ast: {
        ...ast,
        meta: {
          ...ast.meta,
          title: ast.meta.title ?? input.title,
        },
      },
    };
    return codocRepo.create(ctx, { codoc, workspaceId: input.workspaceId });
  }

  // No content — empty AST with just the title.
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
