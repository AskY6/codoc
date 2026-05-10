// RSS plugin API routes — domain-specific REST endpoints.
//
// Mounted under /api/plugins/rss by the host. Owns:
// - POST /refresh — force-refresh all RSS sources
// - POST /digest  — generate deterministic digest into inbox.codoc
// - PATCH /articles/:codocPath+/:field/:index — article state mutation

import { Hono } from "hono";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import { updateArticleState } from "../../workspace-service.js";
import type { WorkspacePluginContext } from "../types.js";
import type { RssPluginConfig } from "./config.js";
import { refreshFeeds, generateDigest } from "./service.js";

export function createRssApiRoutes(
  ctx: WorkspacePluginContext<RssPluginConfig>,
): Hono {
  const api = new Hono();

  const svcCtx = {
    workspace: ctx.workspace,
    updates: ctx.updates,
    pluginConfig: ctx.pluginConfig,
  };

  // POST /refresh — force-refresh all periodic sources.
  api.post("/refresh", async (c) => {
    try {
      const result = await refreshFeeds(svcCtx);
      return c.json(result);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "Refresh failed" }, 500);
    }
  });

  // POST /digest — generate digest into inbox.codoc.
  api.post("/digest", async (c) => {
    try {
      const result = await generateDigest(svcCtx);
      return c.json(result);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "Digest generation failed" }, 500);
    }
  });

  // PATCH /articles/:codocPath+/:field/:index
  // Update a single article's user state (readAt, starred).
  api.patch("/articles/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    // Extract: /articles/<codocPath>/<field>/<index>
    const match = pathname.match(/\/articles\/(.+)\/([^/]+)\/(\d+)$/);

    if (!match) {
      return c.json({ error: "invalid article update path" }, 400);
    }

    const rawPath = decodeURIComponent(match[1]!);
    const path = rawPath.endsWith(".mdx") ? rawPath.replace(/\.mdx$/, ".codoc") : rawPath;
    const field = decodeURIComponent(match[2]!);
    const index = parseInt(match[3]!, 10);

    const body = await c.req.json<{ readAt?: string | null; starred?: boolean }>();

    const result = await updateArticleState(
      { ws: ctx.workspace, updates: ctx.updates },
      mkCodocPath(path),
      mkFieldName(field),
      index,
      body,
    );

    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 400);
    }

    return c.json({ ok: true });
  });

  return api;
}
