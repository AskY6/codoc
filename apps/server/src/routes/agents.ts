// /api/agents — global agent listing.
//
// Agents are seeded at startup and are global (not workspace-scoped).
// This router exposes a read-only list for the UI to populate
// agent pickers.

import type { ServiceCtx } from "@cobook/service";
import { listAgents } from "@cobook/service";
import { Hono } from "hono";

export function agentRoutes(baseCtx: ServiceCtx) {
  const app = new Hono();

  // GET /api/agents — every registered agent
  app.get("/", async (c) => {
    const result = await listAgents(baseCtx);
    return c.json(result);
  });

  return app;
}
