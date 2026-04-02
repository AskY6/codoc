import { Hono } from "hono";
import type { EdgeRepository } from "@cobook/service";
import type { CodocRepository } from "@cobook/service";

export function graphRoutes(
  codocRepo: CodocRepository,
  edgeRepo: EdgeRepository,
) {
  const app = new Hono();

  // GET /api/workspace/:id/graph — get DAG nodes and edges
  app.get("/:id/graph", async (c) => {
    const workspaceId = c.req.param("id");
    const codocs = await codocRepo.listByWorkspace(workspaceId);
    const edges = await edgeRepo.listByWorkspace(workspaceId);

    return c.json({
      nodes: codocs.map((r) => ({
        path: r.path,
        nodeState: r.nodeState,
      })),
      edges: edges.map((e) => ({
        from: e.fromNodeId,
        to: e.toNodeId,
      })),
    });
  });

  return app;
}
