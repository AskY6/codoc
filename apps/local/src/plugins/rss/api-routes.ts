// RSS plugin API routes — domain-specific REST endpoints.
//
// Mounted under /api/plugins/rss by the host. Full API surface:
//
// Subscriptions:
//   GET    /subscriptions           — list with health status
//   POST   /subscriptions           — add feed
//   PATCH  /subscriptions/:slug     — edit title/whyFollow/interval
//   PUT    /subscriptions/:slug/url — change feed URL (state reset)
//   DELETE /subscriptions/:slug     — unsubscribe + cleanup
//   POST   /subscriptions/:slug/refresh — refresh single feed
//
// Articles:
//   PATCH  /articles/:articleId     — update by stable ID (readAt, starred)
//   GET    /saved                   — global starred articles
//
// Digest & Refresh:
//   POST   /refresh                 — force-refresh all feeds
//   POST   /digest                  — generate digest into inbox.codoc
//
// Legacy (backwards compat):
//   PATCH  /articles/:codocPath+/:field/:index — article state by index

import { Hono } from "hono";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import { updateArticleState } from "../../workspace-service.js";
import type { WorkspacePluginContext } from "../types.js";
import type { RssPluginConfig } from "./config.js";
import {
  listSubscriptions,
  getStarredArticles,
  subscribeFeed,
  unsubscribeFeed,
  editSubscription,
  changeSubscriptionUrl,
  refreshFeeds,
  refreshSingleFeed,
  updateArticleById,
  generateDigest,
} from "./service.js";
import { fetchArticleBody } from "./article-fetch.js";

export function createRssApiRoutes(
  ctx: WorkspacePluginContext<RssPluginConfig>,
): Hono {
  const api = new Hono();

  const svcCtx = {
    workspace: ctx.workspace,
    updates: ctx.updates,
    pluginConfig: ctx.pluginConfig,
  };

  // =========================================================================
  // Subscriptions
  // =========================================================================

  // GET /subscriptions — list with health status.
  api.get("/subscriptions", async (c) => {
    try {
      const subs = await listSubscriptions(svcCtx);
      return c.json({ ok: true, subscriptions: subs });
    } catch (e) {
      return c.json({ ok: false, error: errorMsg(e) }, 500);
    }
  });

  // POST /subscriptions — add feed.
  api.post("/subscriptions", async (c) => {
    try {
      const body = await c.req.json<{
        url: string;
        title?: string;
        whyFollow?: string;
        intervalMinutes?: number;
      }>();

      if (!body.url) {
        return c.json({ ok: false, error: "url is required" }, 400);
      }

      const result = await subscribeFeed(svcCtx, body);
      return c.json(result, 201);
    } catch (e) {
      const status = isUserError(e) ? 400 : 500;
      return c.json({ ok: false, error: errorMsg(e) }, status);
    }
  });

  // PATCH /subscriptions/:slug — edit title/whyFollow/interval.
  api.patch("/subscriptions/:slug", async (c) => {
    try {
      const slug = c.req.param("slug");
      const body = await c.req.json<{
        title?: string;
        whyFollow?: string;
        intervalMinutes?: number;
      }>();

      await editSubscription(svcCtx, slug, body);
      return c.json({ ok: true });
    } catch (e) {
      const status = isNotFound(e) ? 404 : 500;
      return c.json({ ok: false, error: errorMsg(e) }, status);
    }
  });

  // PUT /subscriptions/:slug/url — change feed URL (validate-then-commit).
  api.put("/subscriptions/:slug/url", async (c) => {
    try {
      const slug = c.req.param("slug");
      const body = await c.req.json<{ url: string }>();

      if (!body.url) {
        return c.json({ ok: false, error: "url is required" }, 400);
      }

      await changeSubscriptionUrl(svcCtx, slug, body.url);
      return c.json({ ok: true });
    } catch (e) {
      const status = isNotFound(e) ? 404 : isUserError(e) ? 400 : 500;
      return c.json({ ok: false, error: errorMsg(e) }, status);
    }
  });

  // DELETE /subscriptions/:slug — unsubscribe + cleanup.
  api.delete("/subscriptions/:slug", async (c) => {
    try {
      const slug = c.req.param("slug");
      await unsubscribeFeed(svcCtx, slug);
      return c.json({ ok: true });
    } catch (e) {
      const status = isNotFound(e) ? 404 : 500;
      return c.json({ ok: false, error: errorMsg(e) }, status);
    }
  });

  // POST /subscriptions/:slug/refresh — refresh single feed.
  api.post("/subscriptions/:slug/refresh", async (c) => {
    try {
      const slug = c.req.param("slug");
      await refreshSingleFeed(svcCtx, slug);
      return c.json({ ok: true });
    } catch (e) {
      const status = isNotFound(e) ? 404 : 500;
      return c.json({ ok: false, error: errorMsg(e) }, status);
    }
  });

  // =========================================================================
  // Articles
  // =========================================================================

  // PATCH /articles/:articleId — update by stable ID.
  api.patch("/articles/:articleId", async (c) => {
    const articleId = c.req.param("articleId");

    // Distinguish from legacy index-based route (articleId is a 16-char hex).
    if (articleId.length !== 16 || !/^[0-9a-f]+$/.test(articleId)) {
      // Fall through to legacy handler below.
      return legacyArticlePatch(c, ctx);
    }

    try {
      const body = await c.req.json<{ readAt?: string | null; starred?: boolean }>();
      await updateArticleById(svcCtx, articleId, body);
      return c.json({ ok: true });
    } catch (e) {
      const status = isNotFound(e) ? 404 : 500;
      return c.json({ ok: false, error: errorMsg(e) }, status);
    }
  });

  // GET /saved — global starred articles.
  api.get("/saved", (c) => {
    try {
      const articles = getStarredArticles(svcCtx);
      return c.json({ ok: true, articles });
    } catch (e) {
      return c.json({ ok: false, error: errorMsg(e) }, 500);
    }
  });

  // =========================================================================
  // Digest & Refresh
  // =========================================================================

  // POST /refresh — force-refresh all periodic sources.
  api.post("/refresh", async (c) => {
    try {
      const result = await refreshFeeds(svcCtx);
      return c.json(result);
    } catch (e) {
      return c.json({ ok: false, error: errorMsg(e) }, 500);
    }
  });

  // POST /digest — generate digest into inbox.codoc.
  api.post("/digest", async (c) => {
    try {
      const result = await generateDigest(svcCtx);
      return c.json(result);
    } catch (e) {
      return c.json({ ok: false, error: errorMsg(e) }, 500);
    }
  });

  // POST /discuss — fetch readable body for a Discuss chat context.
  // Body cache is shared with digest, so this typically hits the LRU.
  api.post("/discuss", async (c) => {
    try {
      const { link } = await c.req.json<{ link?: string }>();
      if (!link) return c.json({ ok: false, error: "link is required" }, 400);
      const body = await fetchArticleBody(link);
      if (!body) return c.json({ ok: false, error: "could not fetch article" }, 502);
      return c.json({ ok: true, body });
    } catch (e) {
      return c.json({ ok: false, error: errorMsg(e) }, 500);
    }
  });

  // =========================================================================
  // Legacy: PATCH /articles/<codocPath>/<field>/<index>
  // =========================================================================

  api.patch("/articles/*", async (c) => {
    return legacyArticlePatch(c, ctx);
  });

  return api;
}

// ---------------------------------------------------------------------------
// Legacy article patch (index-based)
// ---------------------------------------------------------------------------

async function legacyArticlePatch(
  c: { req: { url: string; json: <T>() => Promise<T> }; json: (data: unknown, status?: number) => Response },
  ctx: WorkspacePluginContext<RssPluginConfig>,
): Promise<Response> {
  const pathname = new URL(c.req.url).pathname;
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
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isNotFound(e: unknown): boolean {
  return e instanceof Error && /not found/i.test(e.message);
}

function isUserError(e: unknown): boolean {
  return e instanceof Error && (
    /invalid/i.test(e.message) ||
    /already/i.test(e.message) ||
    /duplicate/i.test(e.message)
  );
}
