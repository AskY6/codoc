// RSS domain service — product-level actions for the RSS workspace.
//
// Read operations: listSubscriptions, getStarredArticles
// Write operations: subscribeFeed, unsubscribeFeed, editSubscription,
//   changeSubscriptionUrl, refreshFeeds, refreshSingleFeed, generateDigest
// Article mutations: updateArticleById

import type { EventEmitter } from "node:events";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import type { CodocPath, FieldName, NodeId } from "@cobook/core";
import type { RssArticle } from "@cobook/parser";
import type { Workspace } from "../../workspace.js";
import { writeCodoc, removeFile } from "../../workspace.js";
import { updateDataField, updateSourceFieldCache, updateSourceFieldParam } from "../../workspace-service.js";
import { readSourceState, writeSourceState } from "../../source-state.js";
import { refreshAllSources, refreshSingleSource } from "../../source-scheduler.js";
import type { RefreshResult } from "../../source-scheduler.js";
import type { RssPluginConfig } from "./config.js";
import {
  buildSubscriptions,
  generateSourceCodoc,
  slugFromPath,
  type Subscription,
} from "./subscription.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface RssServiceContext {
  readonly workspace: Workspace;
  readonly updates: EventEmitter;
  readonly pluginConfig: RssPluginConfig;
}

// ---------------------------------------------------------------------------
// listSubscriptions
// ---------------------------------------------------------------------------

export async function listSubscriptions(ctx: RssServiceContext): Promise<Subscription[]> {
  const state = await readSourceState(ctx.workspace.sourceDir);
  return buildSubscriptions(ctx.workspace, ctx.pluginConfig.sourcesDir, state);
}

// ---------------------------------------------------------------------------
// getStarredArticles
// ---------------------------------------------------------------------------

export interface StarredArticle extends RssArticle {
  sourceSlug: string;
  sourceTitle: string;
}

export function getStarredArticles(ctx: RssServiceContext): StarredArticle[] {
  const { workspace: ws, pluginConfig } = ctx;
  const result: StarredArticle[] = [];

  for (const [codocPath, codoc] of ws.codocs) {
    if (!String(codocPath).startsWith(pluginConfig.sourcesDir + "/")) continue;

    const slug = slugFromPath(codocPath);
    const titleField = codoc.ast.data.get(mkFieldName("title"));
    const sourceTitle = (titleField?.kind === "static" ? titleField.value : slug) as string;

    for (const [fieldName, field] of codoc.ast.data) {
      if (field.kind !== "source" || field.source !== "rss") continue;

      const resolved = codoc.resolvedData?.[String(fieldName)];
      if (resolved?.kind !== "ready" || !Array.isArray(resolved.value)) continue;

      for (const article of resolved.value as RssArticle[]) {
        if (article.starred) {
          result.push({ ...article, sourceSlug: slug, sourceTitle });
        }
      }
    }
  }

  // Sort by pubDate desc.
  result.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  return result;
}

// ---------------------------------------------------------------------------
// subscribeFeed
// ---------------------------------------------------------------------------

export interface SubscribeInput {
  readonly url: string;
  readonly title?: string;
  readonly whyFollow?: string;
  readonly intervalMinutes?: number;
}

export interface SubscribeResult {
  readonly ok: true;
  readonly slug: string;
  readonly codocPath: string;
}

export async function subscribeFeed(
  ctx: RssServiceContext,
  input: SubscribeInput,
): Promise<SubscribeResult> {
  const { workspace: ws, pluginConfig, updates } = ctx;

  // Validate URL.
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error(`Invalid feed URL: ${input.url}`);
  }

  // Derive slug from URL hostname + pathname.
  const slug = input.title
    ? toSlug(input.title)
    : toSlug(parsed.hostname.replace(/^www\./, "") + parsed.pathname);

  const codocPath = `${pluginConfig.sourcesDir}/${slug}.codoc`;

  // Check for duplicates.
  if (ws.codocs.has(mkCodocPath(codocPath))) {
    throw new Error(`Subscription already exists: ${slug}`);
  }

  // Check duplicate URL across existing subscriptions.
  for (const [cp, codoc] of ws.codocs) {
    if (!String(cp).startsWith(pluginConfig.sourcesDir + "/")) continue;
    const urlField = codoc.ast.data.get(mkFieldName("feedUrl"));
    if (urlField?.kind === "static" && urlField.value === input.url) {
      throw new Error(`Already subscribed to this URL as "${slugFromPath(cp)}"`);
    }
  }

  // Validate feed by fetching.
  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error(`Feed URL returned ${response.status}: ${response.statusText}`);
  }

  const title = input.title ?? parsed.hostname.replace(/^www\./, "");
  const whyFollow = input.whyFollow ?? "";
  const intervalMinutes = input.intervalMinutes ?? pluginConfig.defaultSourceIntervalMinutes;

  const content = generateSourceCodoc({ title, feedUrl: input.url, whyFollow, slug, intervalMinutes });
  const result = await writeCodoc(ws, mkCodocPath(codocPath), content);

  if (!result.ok) {
    throw new Error(`Failed to create subscription: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  }

  // Seed source state so status reflects reality (writeCodoc resolves the data
  // in-memory but doesn't persist state for periodic sources — that's the
  // scheduler's job, but we need it immediately for a consistent read model).
  const newCodoc = ws.codocs.get(mkCodocPath(codocPath));
  if (newCodoc) {
    for (const [fieldName, field] of newCodoc.ast.data) {
      if (field.kind === "source" && field.source === "rss") {
        const nodeId = `${codocPath}#data.${String(fieldName)}`;
        const now = new Date().toISOString();
        const state = await readSourceState(ws.sourceDir);
        const seeded = {
          ...state,
          [nodeId]: {
            ...state[nodeId],
            lastFetchedAt: now,
            lastAttemptAt: now,
            lastError: null,
            consecutiveFailures: 0,
            cachedValue: state[nodeId]?.cachedValue,
          },
        };
        await writeSourceState(ws.sourceDir, seeded);
        break;
      }
    }
  }

  updates.emit("update", { kind: "codoc-updated", codocPath });

  return { ok: true, slug, codocPath };
}

// ---------------------------------------------------------------------------
// unsubscribeFeed
// ---------------------------------------------------------------------------

export async function unsubscribeFeed(
  ctx: RssServiceContext,
  slug: string,
): Promise<void> {
  const { workspace: ws, pluginConfig, updates } = ctx;
  const codocPath = mkCodocPath(`${pluginConfig.sourcesDir}/${slug}.codoc`);

  if (!ws.codocs.has(codocPath)) {
    throw new Error(`Subscription not found: ${slug}`);
  }

  // Find nodeId for source-state cleanup.
  const codoc = ws.codocs.get(codocPath)!;
  const nodeIds: string[] = [];
  for (const [fieldName, field] of codoc.ast.data) {
    if (field.kind === "source") {
      nodeIds.push(`${String(codocPath)}#data.${String(fieldName)}`);
    }
  }

  // Remove the codoc file.
  const absolutePath = join(ws.sourceDir, String(codocPath));
  await unlink(absolutePath).catch(() => {});
  await removeFile(ws, absolutePath);

  // Clean up source-state entries.
  if (nodeIds.length > 0) {
    const state = await readSourceState(ws.sourceDir);
    const cleaned = { ...state };
    for (const nid of nodeIds) {
      delete (cleaned as Record<string, unknown>)[nid];
    }
    await writeSourceState(ws.sourceDir, cleaned);
  }

  updates.emit("update", { kind: "workspace-changed" });
}

// ---------------------------------------------------------------------------
// editSubscription
// ---------------------------------------------------------------------------

export interface EditSubscriptionInput {
  readonly title?: string;
  readonly whyFollow?: string;
  readonly intervalMinutes?: number;
}

export async function editSubscription(
  ctx: RssServiceContext,
  slug: string,
  input: EditSubscriptionInput,
): Promise<void> {
  const { workspace: ws, pluginConfig, updates } = ctx;
  const codocPath = mkCodocPath(`${pluginConfig.sourcesDir}/${slug}.codoc`);

  if (!ws.codocs.has(codocPath)) {
    throw new Error(`Subscription not found: ${slug}`);
  }

  const svcCtx = { ws, updates };

  if (input.title !== undefined) {
    await updateDataField(svcCtx, codocPath, mkFieldName("title"), input.title);
  }
  if (input.whyFollow !== undefined) {
    await updateDataField(svcCtx, codocPath, mkFieldName("whyFollow"), input.whyFollow);
  }
  if (input.intervalMinutes !== undefined) {
    // Find the RSS source field name to patch its `interval` param.
    const codoc = ws.codocs.get(codocPath)!;
    for (const [fieldName, field] of codoc.ast.data) {
      if (field.kind === "source" && field.source === "rss") {
        await updateSourceFieldParam(svcCtx, codocPath, fieldName, "interval", input.intervalMinutes);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// changeSubscriptionUrl
// ---------------------------------------------------------------------------

export async function changeSubscriptionUrl(
  ctx: RssServiceContext,
  slug: string,
  newUrl: string,
): Promise<void> {
  const { workspace: ws, pluginConfig, updates } = ctx;
  const codocPath = mkCodocPath(`${pluginConfig.sourcesDir}/${slug}.codoc`);

  if (!ws.codocs.has(codocPath)) {
    throw new Error(`Subscription not found: ${slug}`);
  }

  // Validate new URL.
  try {
    new URL(newUrl);
  } catch {
    throw new Error(`Invalid URL: ${newUrl}`);
  }

  // Validate by fetching (validate-then-commit).
  const response = await fetch(newUrl);
  if (!response.ok) {
    throw new Error(`New feed URL returned ${response.status}: ${response.statusText}`);
  }

  // Find source field nodeId.
  const codoc = ws.codocs.get(codocPath)!;
  let sourceFieldName: FieldName | null = null;
  for (const [fieldName, field] of codoc.ast.data) {
    if (field.kind === "source" && field.source === "rss") {
      sourceFieldName = fieldName;
      break;
    }
  }

  if (!sourceFieldName) {
    throw new Error(`No RSS source field found in ${slug}`);
  }

  const nodeId = `${String(codocPath)}#data.${String(sourceFieldName)}` as NodeId;

  // Atomic commit: update feedUrl static field + $source url param + clear state.
  const svcCtx = { ws, updates };
  await updateDataField(svcCtx, codocPath, mkFieldName("feedUrl"), newUrl);
  await updateSourceFieldParam(svcCtx, codocPath, sourceFieldName, "url", newUrl);

  // Clear cached value and health state for this nodeId.
  const state = await readSourceState(ws.sourceDir);
  const now = new Date().toISOString();
  const cleared = {
    ...state,
    [nodeId]: {
      lastFetchedAt: now,
      lastAttemptAt: now,
      lastError: null,
      consecutiveFailures: 0,
      cachedValue: undefined,
    },
  };
  await writeSourceState(ws.sourceDir, cleared);
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
// refreshSingleFeed
// ---------------------------------------------------------------------------

export async function refreshSingleFeed(
  ctx: RssServiceContext,
  slug: string,
): Promise<void> {
  const { workspace: ws, pluginConfig, updates } = ctx;
  const codocPath = mkCodocPath(`${pluginConfig.sourcesDir}/${slug}.codoc`);

  if (!ws.codocs.has(codocPath)) {
    throw new Error(`Subscription not found: ${slug}`);
  }

  // Find the source field's nodeId.
  const codoc = ws.codocs.get(codocPath)!;
  for (const [fieldName, field] of codoc.ast.data) {
    if (field.kind === "source" && field.source === "rss") {
      const nodeId = `${String(codocPath)}#data.${String(fieldName)}` as NodeId;
      await refreshSingleSource(ws, nodeId, updates);
      return;
    }
  }

  throw new Error(`No RSS source field found in ${slug}`);
}

// ---------------------------------------------------------------------------
// updateArticleById
// ---------------------------------------------------------------------------

export async function updateArticleById(
  ctx: RssServiceContext,
  articleId: string,
  patch: { readAt?: string | null; starred?: boolean },
): Promise<void> {
  const { workspace: ws, pluginConfig, updates } = ctx;

  // Search all source codocs for the article.
  for (const [codocPath, codoc] of ws.codocs) {
    if (!String(codocPath).startsWith(pluginConfig.sourcesDir + "/")) continue;

    for (const [fieldName, field] of codoc.ast.data) {
      if (field.kind !== "source" || field.source !== "rss") continue;

      const resolved = codoc.resolvedData?.[String(fieldName)];
      if (resolved?.kind !== "ready" || !Array.isArray(resolved.value)) continue;

      const articles = resolved.value as RssArticle[];
      const idx = articles.findIndex((a) => a.articleId === articleId);
      if (idx === -1) continue;

      // Found it — update.
      const updated = articles.map((item, i) =>
        i === idx ? { ...item, ...patch } : item,
      );
      await updateSourceFieldCache(
        { ws, updates },
        codocPath,
        fieldName,
        updated,
      );
      return;
    }
  }

  throw new Error(`Article not found: ${articleId}`);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
