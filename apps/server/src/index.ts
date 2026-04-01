import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.json({ name: "cobook", status: "ok" }));

serve({ fetch: app.fetch, port: 3100 }, (info) => {
  console.log(`cobook server listening on http://localhost:${info.port}`);
});
