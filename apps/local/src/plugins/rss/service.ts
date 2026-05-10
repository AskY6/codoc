// RSS domain service — product-level actions for the RSS workspace.
//
// refreshFeeds: triggers a force-refresh of all periodic sources.
// generateDigest: deterministic first version — collects unread articles,
//   builds highlights + trending, writes to inbox.codoc.

import type { EventEmitter } from "node:events";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import type { Workspace } from "../../workspace.js";
import { updateDataField } from "../../workspace-service.js";
import { refreshAllSources } from "../../source-scheduler.js";
import type { RefreshResult } from "../../source-scheduler.js";
import type { RssPluginConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface RssServiceContext {
  readonly workspace: Workspace;
  readonly updates: EventEmitter;
  readonly pluginConfig: RssPluginConfig;
}

// ---------------------------------------------------------------------------
// refreshFeeds
// ---------------------------------------------------------------------------

export interface RefreshFeedsResult {
  readonly ok: true;
  readonly message: string;
  readonly total: number;
  readonly refreshed: string[];
  readonly failed: { nodeId: string; error: string }[];
}

export async function refreshFeeds(ctx: RssServiceContext): Promise<RefreshFeedsResult> {
  const result: RefreshResult = await refreshAllSources(
    ctx.workspace,
    ctx.updates,
    { force: true },
  );

  const msg = result.refreshed.length > 0
    ? `Refreshed ${result.refreshed.length} of ${result.total} source(s)`
    : result.total === 0
      ? "No sources found"
      : "All sources up to date";

  return {
    ok: true,
    message: msg,
    total: result.total,
    refreshed: result.refreshed,
    failed: result.failed,
  };
}

// ---------------------------------------------------------------------------
// generateDigest
// ---------------------------------------------------------------------------

interface Article {
  title?: string;
  link?: string;
  pubDate?: string;
  source?: string;
  readAt?: string | null;
  starred?: boolean;
  summary?: string;
}

export interface DigestResult {
  readonly ok: true;
  readonly message: string;
  readonly highlightCount: number;
  readonly trendingCount: number;
}

const MAX_HIGHLIGHTS = 15;
const MAX_TRENDING = 5;

export async function generateDigest(ctx: RssServiceContext): Promise<DigestResult> {
  const { workspace: ws, updates, pluginConfig } = ctx;
  const { sourcesDir, digestCodocPath } = pluginConfig;

  // 1. Collect all articles from sources.
  const allArticles: (Article & { feedTitle: string })[] = [];

  for (const [codocPath, codoc] of ws.codocs) {
    if (!String(codocPath).startsWith(sourcesDir + "/")) continue;

    const titleField = codoc.ast.data.get(mkFieldName("title"));
    const feedTitle =
      (titleField?.kind === "static" ? titleField.value : undefined) as string | undefined;

    for (const [fieldName, field] of codoc.ast.data) {
      if (field.kind !== "source") continue;

      const resolved = codoc.resolvedData?.[String(fieldName)];
      const cached = resolved?.kind === "ready" ? resolved.value : undefined;
      if (!Array.isArray(cached)) continue;

      for (const article of cached as Article[]) {
        allArticles.push({
          ...article,
          feedTitle: feedTitle ?? String(codocPath),
        });
      }
    }
  }

  // 2. Filter unread and sort by date (newest first).
  const unread = allArticles
    .filter((a) => !a.readAt)
    .sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });

  // 3. Build highlights (top N unread by date).
  const highlights = unread.slice(0, MAX_HIGHLIGHTS).map((a) => ({
    title: a.title ?? "(untitled)",
    source: a.feedTitle,
    link: a.link ?? "",
    summary: a.summary ?? a.title ?? "",
    pubDate: a.pubDate ?? "",
  }));

  // 4. Build trending (starred articles, or fallback to next batch).
  const starred = allArticles.filter((a) => a.starred);
  const trending = (starred.length > 0 ? starred : unread.slice(MAX_HIGHLIGHTS, MAX_HIGHLIGHTS + MAX_TRENDING))
    .slice(0, MAX_TRENDING)
    .map((a) => ({
      title: a.title ?? "(untitled)",
      source: a.feedTitle,
      link: a.link ?? "",
    }));

  // 5. Write to inbox.codoc.
  const svcCtx = { ws, updates };
  const inboxPath = mkCodocPath(digestCodocPath);

  await updateDataField(svcCtx, inboxPath, mkFieldName("highlights"), highlights);
  await updateDataField(svcCtx, inboxPath, mkFieldName("trending"), trending);
  await updateDataField(svcCtx, inboxPath, mkFieldName("lastDigestAt"), new Date().toISOString());

  return {
    ok: true,
    message: `Digest updated: ${highlights.length} highlight(s), ${trending.length} trending`,
    highlightCount: highlights.length,
    trendingCount: trending.length,
  };
}
