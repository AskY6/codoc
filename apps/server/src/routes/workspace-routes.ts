import { Hono } from "hono";
import type { WorkspaceService } from "@cobook/service";
import type { WorkspaceRepository } from "@cobook/service";

export function workspaceRoutes(
  service: WorkspaceService,
  workspaceRepo: WorkspaceRepository,
) {
  const app = new Hono();

  // GET /api/workspace — list all workspaces (optional ?rootPath= filter)
  app.get("/", async (c) => {
    const rootPath = c.req.query("rootPath");
    if (rootPath) {
      const ws = await workspaceRepo.findByPath(rootPath);
      return c.json(ws ? [ws] : []);
    }
    const list = await workspaceRepo.list();
    return c.json(list);
  });

  // POST /api/workspace — register workspace { rootPath }
  app.post("/", async (c) => {
    const body = await c.req.json<{ rootPath: string }>();
    if (!body.rootPath) {
      return c.json({ error: "rootPath is required" }, 400);
    }
    try {
      const ws = await service.openWorkspace(body.rootPath);
      return c.json(ws, 201);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/workspace/:id — get workspace detail
  app.get("/:id", async (c) => {
    const ws = await workspaceRepo.findById(c.req.param("id"));
    if (!ws) return c.json({ error: "Workspace not found" }, 404);
    return c.json(ws);
  });

  // GET /api/workspace/:id/status — get workspace status
  app.get("/:id/status", async (c) => {
    try {
      const status = await service.getStatus(c.req.param("id"));
      return c.json(status);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // DELETE /api/workspace/:id — remove workspace (unregister only)
  app.delete("/:id", async (c) => {
    try {
      await workspaceRepo.delete(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}
