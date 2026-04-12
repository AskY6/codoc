// /api/workspaces — list / get / create / update / delete, plus the
// nested /:id/codocs collection used by the detail page.
//
// The router is parameterised over a base `ServiceCtx` so the
// composition root in `index.ts` is the only place that picks a
// concrete `Storage` impl. Use case error handling is centralised in
// `../http/error.ts` — never expand a service error inline.

import type { WorkspaceId } from "@cobook/core";
import type { ServiceCtx } from "@cobook/service";
import {
  createCodoc,
  createThread,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listCodocsByWorkspace,
  listThreadsByWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "@cobook/service";
import { Hono } from "hono";
import { respondError } from "../http/error.js";

interface CreateWorkspaceBody {
  readonly name?: unknown;
  readonly description?: unknown;
}

interface UpdateWorkspaceBody {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly expectedRev?: unknown;
}

interface CreateCodocBody {
  readonly path?: unknown;
  readonly title?: unknown;
}

interface CreateThreadBody {
  readonly title?: unknown;
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

  // GET /api/workspaces/:id — single row as a WorkspaceListItem DTO
  app.get("/:id", async (c) => {
    const id = c.req.param("id") as WorkspaceId;
    const result = await getWorkspace(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // GET /api/workspaces/:id/codocs — every codoc in the workspace
  app.get("/:id/codocs", async (c) => {
    const id = c.req.param("id") as WorkspaceId;
    const result = await listCodocsByWorkspace(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // POST /api/workspaces/:id/codocs — { path, title? }
  app.post("/:id/codocs", async (c) => {
    const workspaceId = c.req.param("id") as WorkspaceId;
    let body: CreateCodocBody;
    try {
      body = (await c.req.json()) as CreateCodocBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.path !== "string" || body.path.trim() === "") {
      return c.json(
        { error: { kind: "bad-request", reason: "path is required" } },
        400,
      );
    }
    if (
      body.title !== undefined &&
      body.title !== null &&
      typeof body.title !== "string"
    ) {
      return c.json(
        {
          error: {
            kind: "bad-request",
            reason: "title must be a string or null",
          },
        },
        400,
      );
    }

    const result = await createCodoc(baseCtx, {
      workspaceId,
      path: body.path.trim(),
      title:
        typeof body.title === "string" && body.title.trim() !== ""
          ? body.title.trim()
          : null,
    });

    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value, 201);
  });

  // GET /api/workspaces/:id/threads — every thread in the workspace
  app.get("/:id/threads", async (c) => {
    const id = c.req.param("id") as WorkspaceId;
    const result = await listThreadsByWorkspace(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // POST /api/workspaces/:id/threads — { title? }
  app.post("/:id/threads", async (c) => {
    const workspaceId = c.req.param("id") as WorkspaceId;
    let body: CreateThreadBody;
    try {
      body = (await c.req.json()) as CreateThreadBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (
      body.title !== undefined &&
      body.title !== null &&
      typeof body.title !== "string"
    ) {
      return c.json(
        {
          error: {
            kind: "bad-request",
            reason: "title must be a string or null",
          },
        },
        400,
      );
    }

    const result = await createThread(baseCtx, {
      workspaceId,
      title:
        typeof body.title === "string" && body.title.trim() !== ""
          ? body.title.trim()
          : null,
    });

    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value, 201);
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

  // PATCH /api/workspaces/:id — { name, description?, expectedRev }
  app.patch("/:id", async (c) => {
    const id = c.req.param("id") as WorkspaceId;
    let body: UpdateWorkspaceBody;
    try {
      body = (await c.req.json()) as UpdateWorkspaceBody;
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
    if (typeof body.expectedRev !== "string" || body.expectedRev === "") {
      return c.json(
        {
          error: { kind: "bad-request", reason: "expectedRev is required" },
        },
        400,
      );
    }

    const result = await updateWorkspace(baseCtx, {
      id,
      name: body.name.trim(),
      description:
        typeof body.description === "string" ? body.description : null,
      expectedRev: body.expectedRev,
    });

    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
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
