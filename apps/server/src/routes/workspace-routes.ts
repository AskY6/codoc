import { Hono } from "hono";
import type { WorkspaceService } from "@cobook/service";
import type { WorkspaceRepository } from "@cobook/service";

export function workspaceRoutes(
  service: WorkspaceService,
  workspaceRepo: WorkspaceRepository,
) {
  const app = new Hono();

  // GET /api/workspace — list all workspaces (with codoc/agent counts)
  app.get("/", async (c) => {
    const list = await workspaceRepo.listWithStats();
    return c.json(list);
  });

  // POST /api/workspace — create workspace { name }
  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string }>();
    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }
    try {
      const ws = await service.createWorkspace(body.name);
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

  // PATCH /api/workspace/:id — update workspace name / description
  app.patch("/:id", async (c) => {
    const body = await c.req.json<{ name?: string; description?: string | null }>();
    try {
      const ws = await service.updateWorkspace(c.req.param("id"), body);
      return c.json(ws);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // DELETE /api/workspace/:id — remove workspace
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
