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
import type { ServiceCtx } from "@cobook/service";
import { SystemClock, createMemoryStorage } from "@cobook/storage-memory";
import { Hono } from "hono";
import { UuidIdGenerator } from "./ports/id.js";
import { codocRoutes } from "./routes/codocs.js";
import { workspaceRoutes } from "./routes/workspaces.js";

const storage = createMemoryStorage();
const baseCtx: ServiceCtx = {
  storage,
  storageCtx: storage.ctx(),
  clock: new SystemClock(),
  idGen: new UuidIdGenerator(),
};

const app = new Hono();

app.get("/", (c) => c.json({ name: "cobook", status: "ok" }));
app.route("/api/workspaces", workspaceRoutes(baseCtx));
app.route("/api/codocs", codocRoutes(baseCtx));

const port = Number(process.env["PORT"] ?? 3100);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`cobook server listening on http://localhost:${info.port}`);
});
