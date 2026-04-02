import { Hono } from "hono";
import type { WorkspaceService } from "@cobook/service";
import type { CodocRepository } from "@cobook/service";

export function codocRoutes(
  service: WorkspaceService,
  codocRepo: CodocRepository,
) {
  const app = new Hono();

  // GET /api/workspace/:id/codocs — list codocs in workspace
  app.get("/:id/codocs", async (c) => {
    const list = await codocRepo.listByWorkspace(c.req.param("id"));
    return c.json(
      list.map((r) => ({
        path: r.path,
        nodeState: r.nodeState,
      })),
    );
  });

  // GET /api/workspace/:id/codoc/* — get single codoc detail
  app.get("/:id/codoc/*", async (c) => {
    const codocPath = c.req.path.replace(
      new RegExp(`^.*/workspace/${c.req.param("id")}/codoc/`),
      "",
    );
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
      return c.json({ error: String(err) }, 500);
    }
  });

  // PUT /api/workspace/:id/codoc/* — update codoc { content }
  app.put("/:id/codoc/*", async (c) => {
    const codocPath = c.req.path.replace(
      new RegExp(`^.*/workspace/${c.req.param("id")}/codoc/`),
      "",
    );
    if (!codocPath) return c.json({ error: "path is required" }, 400);

    const body = await c.req.json<{ content: string }>();
    if (body.content === undefined) {
      return c.json({ error: "content is required" }, 400);
    }
    try {
      await service.updateCodoc(c.req.param("id"), codocPath, body.content);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // DELETE /api/workspace/:id/codoc/* — delete codoc
  app.delete("/:id/codoc/*", async (c) => {
    const codocPath = c.req.path.replace(
      new RegExp(`^.*/workspace/${c.req.param("id")}/codoc/`),
      "",
    );
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
