import dotenv from "dotenv";
import { resolve } from "node:path";

// Load .env — try CWD first, then monorepo root (for pnpm --filter runs)
dotenv.config();
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  createDb,
  createWorkspaceRepository,
  createCodocRepository,
  createEdgeRepository,
  createChatRepository,
  createAgentSessionRepository,
  createWorkspaceService,
  createChatService,
} from "@cobook/service";
import { createBaseAgent } from "@cobook/agent";
import { workspaceRoutes } from "./routes/workspace-routes.js";
import { codocRoutes } from "./routes/codoc-routes.js";
import { buildRoutes } from "./routes/build-routes.js";
import { graphRoutes } from "./routes/graph-routes.js";
import { chatRoutes } from "./routes/chat-routes.js";

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
// Repositories & Service
// ---------------------------------------------------------------------------

const workspaceRepo = createWorkspaceRepository(db);
const codocRepo = createCodocRepository(db);
const edgeRepo = createEdgeRepository(db);

const chatRepo = createChatRepository(db);
const agentSessionRepo = createAgentSessionRepository(db);

const service = createWorkspaceService({ workspaceRepo, codocRepo, edgeRepo });
const chatService = createChatService({ chatRepo, agentSessionRepo });
const llmBaseURL = process.env["LLM_BASE_URL"];
const llmApiKey = process.env["LLM_API_KEY"];
const llmModel = process.env["LLM_MODEL"];
const agent = createBaseAgent({
  ...(llmBaseURL && { baseURL: llmBaseURL }),
  ...(llmApiKey && { apiKey: llmApiKey }),
  ...(llmModel && { model: llmModel }),
});

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

app.get("/", (c) => c.json({ name: "cobook", status: "ok" }));

app.route("/api/workspace", workspaceRoutes(service, workspaceRepo));
app.route("/api/workspace", codocRoutes(service, codocRepo));
app.route("/api/workspace", buildRoutes(service));
app.route("/api/workspace", graphRoutes(codocRepo, edgeRepo));
app.route("/api/chat", chatRoutes(chatService, service, agent));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = Number(process.env["PORT"] ?? 3100);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`cobook server listening on http://localhost:${info.port}`);
});

// Graceful shutdown
function shutdown() {
  server.close();
  db.$pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
