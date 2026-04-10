import dotenv from "dotenv";

// Load .env — try CWD first, then monorepo root (for pnpm --filter runs)
dotenv.config();
dotenv.config({ path: "../../.env" });

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createDb,
  createWorkspaceService,
  createChatService,
} from "@cobook/service";
import { createBaseAgent, createRssAgent, createClaudeCodeLogAgent } from "@cobook/agent";
import { workspaceRoutes } from "./routes/workspace-routes.js";
import { codocRoutes } from "./routes/codoc-routes.js";
import { buildRoutes } from "./routes/build-routes.js";
import { graphRoutes } from "./routes/graph-routes.js";
import { chatRoutes, type AgentRegistry } from "./routes/chat-routes.js";
import { createRssScheduler } from "./rss-scheduler.js";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
//
// Services own the db handle and build their own repositories internally.
// Routes must only consume services — no direct repository access.

const service = createWorkspaceService({ db });
const chatService = createChatService({ db });
const llmBaseURL = process.env["LLM_BASE_URL"];
const llmApiKey = process.env["LLM_API_KEY"];
const llmModel = process.env["LLM_MODEL"];
const agents: AgentRegistry = new Map();
const llmConfig = {
  ...(llmBaseURL && { baseURL: llmBaseURL }),
  ...(llmApiKey && { apiKey: llmApiKey }),
  ...(llmModel && { model: llmModel }),
};
agents.set("base", createBaseAgent({
  ...llmConfig,
  name: "Cobook Assistant",
  description: "General workspace assistant — manage codocs, answer questions, and build knowledge",
}));
agents.set("rss", createRssAgent(llmConfig));
agents.set("claude-code-log", createClaudeCodeLogAgent(llmConfig));

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

app.use("*", cors());

app.get("/", (c) => c.json({ name: "cobook", status: "ok" }));

app.route("/api/workspace", workspaceRoutes(service));
app.route("/api/workspace", codocRoutes(service));
app.route("/api/workspace", buildRoutes(service));
app.route("/api/workspace", graphRoutes(service));
app.route("/api/chat", chatRoutes(chatService, service, agents, llmConfig));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const rssScheduler = createRssScheduler({ service });

const port = Number(process.env["PORT"] ?? 3100);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`cobook server listening on http://localhost:${info.port}`);
  rssScheduler.start();
});

// Graceful shutdown
function shutdown() {
  rssScheduler.stop();
  server.close();
  db.$pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
