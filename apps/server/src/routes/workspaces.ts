// /api/workspaces — list / create / delete
//
// The router is parameterised over a base `ServiceCtx` so the
// composition root in `index.ts` is the only place that picks a
// concrete `Storage` impl. Use case error handling is centralised in
// `../http/error.ts` — never expand a service error inline.

import type { WorkspaceId } from "@cobook/core";
import type { ServiceCtx } from "@cobook/service";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "@cobook/service";
import { Hono } from "hono";
import { respondError } from "../http/error.js";

interface CreateWorkspaceBody {
  readonly name?: unknown;
  readonly description?: unknown;
}

export function workspaceRoutes(baseCtx: ServiceCtx) {
  const app = new Hono();

  // GET /api/workspaces — full list
  app.get("/", async (c) => {
    const result = await listWorkspaces(baseCtx);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // POST /api/workspaces — { name, description? }
  app.post("/", async (c) => {
    let body: CreateWorkspaceBody;
    try {
      body = (await c.req.json()) as CreateWorkspaceBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(
        { error: { kind: "bad-request", reason: "name is required" } },
        400,
      );
    }
    if (
      body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== "string"
    ) {
      return c.json(
        {
          error: {
            kind: "bad-request",
            reason: "description must be a string or null",
          },
        },
        400,
      );
    }

    const result = await createWorkspace(baseCtx, {
      name: body.name.trim(),
      description:
        typeof body.description === "string" ? body.description : null,
    });

    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value, 201);
  });

  // DELETE /api/workspaces/:id
  app.delete("/:id", async (c) => {
    const id = c.req.param("id") as WorkspaceId;
    const result = await deleteWorkspace(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.body(null, 204);
  });

  return app;
}
