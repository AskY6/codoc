import { Hono } from "hono";
import { ParseError } from "@cobook/core";
import type { WorkspaceService } from "@cobook/service";
import type { CodocRepository } from "@cobook/service";

function extractCodocPath(reqPath: string, workspaceId: string): string {
  const prefix = `/workspace/${workspaceId}/codoc/`;
  const idx = reqPath.indexOf(prefix);
  return idx >= 0 ? reqPath.slice(idx + prefix.length) : "";
}

export function codocRoutes(
  service: WorkspaceService,
  codocRepo: CodocRepository,
) {
  const app = new Hono();

  // GET /api/workspace/:id/codocs — list codocs in workspace
  app.get("/:id/codocs", async (c) => {
    const list = await service.listCodocs(c.req.param("id"));
    return c.json(list);
  });

  // GET /api/workspace/:id/codoc/* — get single codoc detail
  app.get("/:id/codoc/*", async (c) => {
    const codocPath = extractCodocPath(c.req.path, c.req.param("id"));
    if (!codocPath) return c.json({ error: "path is required" }, 400);

    const info = await service.getCodoc(c.req.param("id"), codocPath);
    if (!info) return c.json({ error: "Codoc not found" }, 404);
    return c.json(info);
  });

  // POST /api/workspace/:id/codoc — create codoc { path, content }
  app.post("/:id/codoc", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>();
    if (!body.path || body.content === undefined) {
      return c.json({ error: "path and content are required" }, 400);
    }
    try {
      await service.createCodoc(c.req.param("id"), body.path, body.content);
      return c.json({ ok: true }, 201);
    } catch (err) {
      if (err instanceof ParseError) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: String(err) }, 500);
    }
  });

  // PUT /api/workspace/:id/codoc/* — update codoc { content }
  app.put("/:id/codoc/*", async (c) => {
    const codocPath = extractCodocPath(c.req.path, c.req.param("id"));
    if (!codocPath) return c.json({ error: "path is required" }, 400);

    const body = await c.req.json<{ content: string }>();
    if (body.content === undefined) {
      return c.json({ error: "content is required" }, 400);
    }
    try {
      await service.updateCodoc(c.req.param("id"), codocPath, body.content);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ParseError) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: String(err) }, 500);
    }
  });

  // PATCH /api/workspace/:id/codoc/*/data — patch a single data field
  app.patch("/:id/codoc/*/data", async (c) => {
    const fullPath = extractCodocPath(c.req.path, c.req.param("id"));
    const codocPath = fullPath.endsWith("/data") ? fullPath.slice(0, -5) : fullPath;
    if (!codocPath) return c.json({ error: "path is required" }, 400);

    const body = await c.req.json<{ path: string; value: unknown }>();
    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }
    try {
      await service.patchCodocData(c.req.param("id"), codocPath, body.path, body.value);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ParseError) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: String(err) }, 500);
    }
  });

  // DELETE /api/workspace/:id/codoc/* — delete codoc
  app.delete("/:id/codoc/*", async (c) => {
    const codocPath = extractCodocPath(c.req.path, c.req.param("id"));
    if (!codocPath) return c.json({ error: "path is required" }, 400);

    try {
      await service.deleteCodoc(c.req.param("id"), codocPath);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}
