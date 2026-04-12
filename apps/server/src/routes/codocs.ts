// /api/codocs — codoc-scoped actions that don't fit under a workspace
// path. Slice 2 shipped `DELETE /:id`; slice 3 adds `GET /:id` and
// `PUT /:id` alongside the detail page.
//
// The router is parameterised over a base `ServiceCtx` so the
// composition root in `index.ts` is the only place that picks a
// concrete `Storage` impl.

import type { CodocId } from "@cobook/core";
import type { ServiceCtx } from "@cobook/service";
import { deleteCodoc, getCodoc, updateCodocContent } from "@cobook/service";
import { Hono } from "hono";
import { respondError } from "../http/error.js";

interface UpdateCodocBody {
  readonly content?: unknown;
  readonly expectedRev?: unknown;
}

export function codocRoutes(baseCtx: ServiceCtx) {
  const app = new Hono();

  // GET /api/codocs/:id — single codoc as a CodocDetail DTO
  app.get("/:id", async (c) => {
    const id = c.req.param("id") as CodocId;
    const result = await getCodoc(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // PUT /api/codocs/:id — full content replace, { content, expectedRev }
  app.put("/:id", async (c) => {
    const id = c.req.param("id") as CodocId;
    let body: UpdateCodocBody;
    try {
      body = (await c.req.json()) as UpdateCodocBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.content !== "string") {
      return c.json(
        {
          error: {
            kind: "bad-request",
            reason: "content is required and must be a string",
          },
        },
        400,
      );
    }
    if (typeof body.expectedRev !== "string" || body.expectedRev === "") {
      return c.json(
        {
          error: { kind: "bad-request", reason: "expectedRev is required" },
        },
        400,
      );
    }

    const result = await updateCodocContent(baseCtx, {
      id,
      content: body.content,
      expectedRev: body.expectedRev,
    });

    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // DELETE /api/codocs/:id
  app.delete("/:id", async (c) => {
    const id = c.req.param("id") as CodocId;
    const result = await deleteCodoc(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.body(null, 204);
  });

  return app;
}
