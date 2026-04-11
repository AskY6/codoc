// /api/codocs — codoc-scoped actions that don't fit under a workspace
// path. Slice 2 ships `DELETE /:id` only; slice 3 will add `GET /:id`
// and `PATCH /:id` alongside the detail page.
//
// The router is parameterised over a base `ServiceCtx` so the
// composition root in `index.ts` is the only place that picks a
// concrete `Storage` impl.

import type { CodocId } from "@cobook/core";
import type { ServiceCtx } from "@cobook/service";
import { deleteCodoc } from "@cobook/service";
import { Hono } from "hono";
import { respondError } from "../http/error.js";

export function codocRoutes(baseCtx: ServiceCtx) {
  const app = new Hono();

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
