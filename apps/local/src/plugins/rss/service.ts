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
import type { Workspace } from "../../workspace/index.js";
import { writeCodoc, removeFile } from "../../workspace/index.js";
import { updateDataField, updateSourceFieldCache, updateSourceFieldParam } from "../../workspace/service.js";
import { readSourceState, writeSourceState } from "../../sources/state.js";
import { refreshAllSources, refreshSingleSource } from "../../sources/scheduler.js";
import type { RefreshResult } from "../../sources/scheduler.js";
import type { RssPluginConfig } from "./config.js";
import {
  buildSubscriptions,
  generateSourceCodoc,
  slugFromPath,
  type Subscription,
} from "./subscription.js";
import { rankForDigest, type RankableArticle } from "./ranking.js";
import { enhanceSummaries, type SummaryInput } from "./ai-summary.js";
import { fetchManyBodies } from "./article-fetch.js";

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

export interface DigestResult {
  readonly ok: true;
  readonly message: string;
  readonly highlightCount: number;
  readonly trendingCount: number;
  readonly aiEnhanced: boolean;
}

const MAX_HIGHLIGHTS = 15;
const MAX_TRENDING = 5;

export async function generateDigest(ctx: RssServiceContext): Promise<DigestResult> {
  const { workspace: ws, updates, pluginConfig } = ctx;
  const { sourcesDir, digestCodocPath } = pluginConfig;

  // 1. Collect all articles from sources.
  const allArticles: RankableArticle[] = [];

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

      for (const article of cached as Array<Record<string, unknown>>) {
        allArticles.push({
          title: (article.title as string) ?? undefined,
          link: (article.link as string) ?? undefined,
          pubDate: (article.pubDate as string) ?? undefined,
          description: (article.description as string) ?? undefined,
          readAt: (article.readAt as string | null) ?? null,
          starred: (article.starred as boolean) ?? false,
          feedTitle: feedTitle ?? String(codocPath),
        });
      }
    }
  }

  // 2. Rank unread articles using multi-signal scoring + source diversity.
  const unread = allArticles.filter((a) => !a.readAt);
  const { highlights: rankedHighlights, trending: rankedTrending } =
    rankForDigest(unread, MAX_HIGHLIGHTS, MAX_TRENDING);

  // 3. Fetch readable body for each ranked article. The body is the foundation
  //    for AI summary AND for Discuss chat context; cached for 30m so the
  //    Discuss click can reuse it without re-fetching.
  const allRanked = [...rankedHighlights, ...rankedTrending];
  const linksToFetch = allRanked.map((a) => a.link ?? "").filter(Boolean);
  console.log(`[digest] fetching ${linksToFetch.length} article bodies...`);
  const bodies = await fetchManyBodies(linksToFetch);
  console.log(`[digest] fetched ${[...bodies.values()].filter(Boolean).length}/${linksToFetch.length} bodies`);

  // 4. Build summary inputs — prefer body when fetched, else description.
  const summaryInputs: SummaryInput[] = allRanked.map((a, i) => ({
    id: String(i),
    title: a.title ?? "(untitled)",
    body: (a.link && bodies.get(a.link)) || undefined,
    description: a.description ?? undefined,
    source: a.feedTitle,
  }));

  // 5. AI summaries — paragraph-shaped, written from body when available.
  const aiSummaries = await enhanceSummaries(summaryInputs);
  const aiEnhanced = aiSummaries.size > 0;

  // 6. Fallback chain: AI → first paragraph of body → cleaned description → title.
  const buildSummary = (a: RankableArticle, id: string): string => {
    const ai = aiSummaries.get(id);
    if (ai) return ai;
    const body = a.link ? bodies.get(a.link) : null;
    if (body) {
      const para = firstParagraph(body);
      if (para) return para;
    }
    return extractSummary(a.description) || a.title || "";
  };

  const highlights = rankedHighlights.map((a, i) => ({
    title: a.title ?? "(untitled)",
    source: a.feedTitle,
    link: a.link ?? "",
    summary: buildSummary(a, String(i)),
    pubDate: a.pubDate ?? "",
  }));

  const trending = rankedTrending.map((a, i) => ({
    title: a.title ?? "(untitled)",
    source: a.feedTitle,
    link: a.link ?? "",
    summary: buildSummary(a, String(rankedHighlights.length + i)),
  }));

  // 7. Write to inbox.codoc.
  const svcCtx = { ws, updates };
  const inboxPath = mkCodocPath(digestCodocPath);

  await updateDataField(svcCtx, inboxPath, mkFieldName("highlights"), highlights);
  await updateDataField(svcCtx, inboxPath, mkFieldName("trending"), trending);
  await updateDataField(svcCtx, inboxPath, mkFieldName("lastDigestAt"), new Date().toISOString());

  const aiTag = aiEnhanced ? " (AI-enhanced)" : "";
  return {
    ok: true,
    message: `Digest updated: ${highlights.length} highlight(s), ${trending.length} trending${aiTag}`,
    highlightCount: highlights.length,
    trendingCount: trending.length,
    aiEnhanced,
  };
}

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

const FIRST_PARA_MAX = 400;

/**
 * Extract the first substantive paragraph from a markdown body.
 *
 * Skips title lines, image/link-only lines, and metadata lines; returns the
 * first 2-sentence chunk that looks like actual prose.
 */
const NOISY_PREFIX_RE = /^(image|figure|caption|source|by|published|posted|tags?|category)\s*[:|]/i;
const NOISY_KEYWORD_RE = /\b(sponsored by|advertisement|skip to main|subscribe to|enable javascript|cookies? policy)\b/i;
const ALL_LINKS_RE = /^[\s|·\-,*]*(\[[^\]]+\][\s|·\-,*]*){3,}$/;

function firstParagraph(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  for (const raw of blocks) {
    // Reject blocks that look like link lists (nav, footer) before stripping.
    if (ALL_LINKS_RE.test(raw.trim())) continue;

    const text = raw
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*[*\-+]\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/[*_]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Skip too-short or noisy preambles.
    if (text.length < 80) continue;
    if (NOISY_PREFIX_RE.test(text)) continue;
    if (NOISY_KEYWORD_RE.test(text)) continue;
    // Require at least one real sentence — paragraphs without ending
    // punctuation are usually nav, table-of-contents, or buttons.
    if (!/[.!?]/.test(text)) continue;
    // Nav-y blocks that collapsed to letters-and-separators only.
    if (!/[a-z]{4,}\s+[a-z]{3,}/i.test(text)) continue;

    if (text.length <= FIRST_PARA_MAX) return text;
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
    if (sentences.length >= 2) {
      const two = sentences.slice(0, 3).join(" ").trim();
      if (two.length <= FIRST_PARA_MAX) return two;
    }
    return text.slice(0, FIRST_PARA_MAX - 1) + "…";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Summary extraction
// ---------------------------------------------------------------------------

const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITY_RE = /&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi;
const WHITESPACE_RE = /\s+/g;
const MAX_SUMMARY_LEN = 200;
const MIN_USEFUL_LEN = 20;

/** Common HTML entities. */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
};

/** Lines that are feed metadata, not article content. */
const NOISE_RE = /^(article url|comments url|points|# comments|comments)[\s:]/i;

/** Mostly URLs / numbers — not a real sentence. */
const JUNK_RE = /^[\s\d:/.?&#=_%+-]+$/;

/**
 * Extract a human-readable summary from a feed description field.
 *
 * Returns empty string when the description is metadata noise (e.g. hnrss.org)
 * or too short to be useful — the caller falls back to title-only display.
 */
function extractSummary(raw?: string): string {
  if (!raw) return "";

  // Decode entities FIRST — atom feeds escape HTML as &lt;p&gt; etc, so tags only
  // become matchable after decoding. Then strip tags. Then collapse whitespace.
  let text = raw
    .replace(HTML_ENTITY_RE, (_m, dec, hex, named) => {
      if (dec) return String.fromCharCode(Number(dec));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      return ENTITIES[named?.toLowerCase() ?? ""] ?? "";
    })
    .replace(HTML_TAG_RE, "\n")
    .replace(WHITESPACE_RE, " ")
    .trim();

  // Filter out metadata noise lines (hnrss.org pattern).
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const useful = lines.filter((l) => !NOISE_RE.test(l) && !JUNK_RE.test(l));
  text = useful.join(" ").replace(WHITESPACE_RE, " ").trim();

  // Too short to be a real summary — return empty, let caller use title.
  if (text.length < MIN_USEFUL_LEN) return "";

  if (text.length <= MAX_SUMMARY_LEN) return text;

  // Truncate at last sentence boundary within limit.
  const truncated = text.slice(0, MAX_SUMMARY_LEN);
  const lastPeriod = truncated.lastIndexOf(". ");
  return lastPeriod > MAX_SUMMARY_LEN / 2
    ? truncated.slice(0, lastPeriod + 1)
    : truncated + "\u2026";
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
