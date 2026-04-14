// Composition root for the dev server.
//
// Picks the concrete impls (memory storage, UUID id gen, system clock),
// builds a single shared `ServiceCtx`, and mounts the routers. Routes
// import use cases by name; nothing else in the app picks an impl.
//
// Wiring rules (also in apps/server/src/AGENTS.md):
//   - Only THIS file imports from `@cobook/storage-memory` (or any other
//     concrete storage adapter).
//   - Only THIS file mints a `ServiceCtx`.
//   - Routers take a `ServiceCtx` and never see how it was built.

import { serve } from "@hono/node-server";
import { AgentId } from "@cobook/core";
import type { ServiceCtx, LlmConfig } from "@cobook/service";
import { createSourceRegistry } from "@cobook/service";
import { createPgStorage } from "@cobook/storage-pg";
import { SystemClock } from "@cobook/storage-memory";
import { Hono } from "hono";
import { UuidIdGenerator } from "./ports/id.js";
import { agentRoutes } from "./routes/agents.js";
import { codocRoutes } from "./routes/codocs.js";
import { threadRoutes } from "./routes/threads.js";
import { workspaceRoutes } from "./routes/workspaces.js";

// ---- LLM config from env ------------------------------------------------

const llmModel = process.env["LLM_MODEL"];
const llmConfig: LlmConfig = {
  apiKey: process.env["LLM_API_KEY"],
  baseURL: process.env["LLM_BASE_URL"],
  routerModel: process.env["LLM_ROUTER_MODEL"] ?? llmModel,
  defaultModel: llmModel,
};

// ---- Storage + context ---------------------------------------------------

const storage = createPgStorage({
  connectionString: process.env["DATABASE_URL"]!,
});
const baseCtx: ServiceCtx = {
  storage,
  storageCtx: storage.ctx(),
  clock: new SystemClock(),
  idGen: new UuidIdGenerator(),
  llmConfig,
  sourceProviders: createSourceRegistry(),
};

// ---- Seed agents (idempotent on restart) ---------------------------------

async function seedAgents(): Promise<void> {
  const agents = [
    {
      id: AgentId("base"),
      name: "Cobook Assistant",
      description: "General workspace assistant",
    },
    {
      id: AgentId("rss"),
      name: "RSS Reader",
      description:
        "Subscribe to RSS feeds, read articles, and save summaries",
    },
    {
      id: AgentId("perf-review"),
      name: "Performance Reviewer",
      description:
        "绩效材料录入、review 评审、评分、校准。Handle all performance review tasks: record/intake materials (录入绩效材料), review and score, calibrate.",
    },
  ];

  for (const listing of agents) {
    const existing = await storage.agents.get(storage.ctx(), listing.id);
    if (!existing.ok) {
      await storage.agents.create(storage.ctx(), listing);
    } else if (existing.value.listing.description !== listing.description) {
      // Description changed — delete and recreate to update.
      await storage.agents.delete(storage.ctx(), listing.id);
      await storage.agents.create(storage.ctx(), listing);
    }
  }
}

// ---- App setup -----------------------------------------------------------

const app = new Hono();

app.get("/", (c) => c.json({ name: "cobook", status: "ok" }));
app.route("/api/agents", agentRoutes(baseCtx));
app.route("/api/workspaces", workspaceRoutes(baseCtx));
app.route("/api/codocs", codocRoutes(baseCtx));
app.route("/api/threads", threadRoutes(baseCtx));

const port = Number(process.env["PORT"] ?? 3100);

seedAgents().then(() => {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`cobook server listening on http://localhost:${info.port}`);
  });
});
