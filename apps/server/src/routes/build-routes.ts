import { Hono } from "hono";
import type { WorkspaceService } from "@cobook/service";

export function buildRoutes(service: WorkspaceService) {
  const app = new Hono();

  // POST /api/workspace/:id/build — trigger full build
  app.post("/:id/build", async (c) => {
    try {
      const result = await service.build(c.req.param("id"));
      return c.json({
        ok: result.ok,
        codocCount: result.codocCount,
        edgeCount: result.edgeCount,
        errors: result.errors,
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /api/workspace/:id/resolve — resolve a node { nodeId }
  app.post("/:id/resolve", async (c) => {
    const body = await c.req.json<{ nodeId: string }>();
    if (!body.nodeId) {
      return c.json({ error: "nodeId is required" }, 400);
    }
    try {
      const value = await service.resolve(c.req.param("id"), body.nodeId);
      return c.json({ nodeId: body.nodeId, value });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}
