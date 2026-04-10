import { Hono } from "hono";
import type { WorkspaceService } from "@cobook/service";

export function graphRoutes(service: WorkspaceService) {
  const app = new Hono();

  // GET /api/workspace/:id/graph — get DAG nodes and edges
  app.get("/:id/graph", async (c) => {
    const graph = await service.getGraph(c.req.param("id"));
    return c.json(graph);
  });

  return app;
}
