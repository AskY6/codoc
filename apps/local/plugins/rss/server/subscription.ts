// Subscription read model — computed from codoc + source-state.
//
// Not a separate data source. Every field is derived from the codoc AST,
// resolved data, and .source-state.json.

import type { CodocPath, FieldName } from "@cobook/core";
import type { RssArticle } from "@cobook/parser";
import type { Workspace } from "../../../src/domain/types.js";
import type { SourceStateMap } from "../../../src/sources/state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedStatus = "healthy" | "failing" | "never-fetched";

export interface Subscription {
  readonly slug: string;
  readonly title: string;
  readonly feedUrl: string;
  readonly whyFollow: string;
  readonly codocPath: string;
  readonly intervalMinutes: number;
  readonly articleCount: number;
  readonly unreadCount: number;
  readonly starredCount: number;
  readonly lastFetchedAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly status: FeedStatus;
}

// ---------------------------------------------------------------------------
// Read model builder
// ---------------------------------------------------------------------------

export function buildSubscriptions(
  ws: Workspace,
  sourcesDir: string,
  sourceState: SourceStateMap,
): Subscription[] {
  const result: Subscription[] = [];

  for (const [codocPath, codoc] of ws.codocs) {
    if (!String(codocPath).startsWith(sourcesDir + "/")) continue;

    // Find the RSS source field.
    let sourceFieldName: FieldName | null = null;
    let intervalMinutes = 30;

    for (const [fieldName, field] of codoc.ast.data) {
      if (field.kind === "source" && field.source === "rss") {
        sourceFieldName = fieldName;
        if (field.fetch.kind === "periodic") {
          intervalMinutes = field.fetch.interval;
        }
        break;
      }
    }

    if (!sourceFieldName) continue;

    // Extract static fields.
    const titleField = codoc.ast.data.get("title" as FieldName);
    const title = (titleField?.kind === "static" ? titleField.value : "") as string;

    const feedUrlField = codoc.ast.data.get("feedUrl" as FieldName);
    const feedUrl = (feedUrlField?.kind === "static" ? feedUrlField.value : "") as string;

    const whyFollowField = codoc.ast.data.get("whyFollow" as FieldName);
    const whyFollow = (whyFollowField?.kind === "static" ? whyFollowField.value : "") as string;

    // Derive slug from path.
    const slug = slugFromPath(codocPath);

    // Read cached articles.
    const resolved = codoc.resolvedData?.[String(sourceFieldName)];
    const articles: RssArticle[] =
      resolved?.kind === "ready" && Array.isArray(resolved.value)
        ? (resolved.value as RssArticle[])
        : [];

    // Source state.
    const nodeId = `${codocPath}#data.${String(sourceFieldName)}`;
    const state = sourceState[nodeId];

    const lastFetchedAt = state?.lastFetchedAt ?? null;
    const lastAttemptAt = state?.lastAttemptAt ?? null;
    const lastError = state?.lastError ?? null;
    const consecutiveFailures = state?.consecutiveFailures ?? 0;

    const status: FeedStatus = !lastFetchedAt
      ? "never-fetched"
      : consecutiveFailures > 0
        ? "failing"
        : "healthy";

    result.push({
      slug,
      title,
      feedUrl,
      whyFollow,
      codocPath: String(codocPath),
      intervalMinutes,
      articleCount: articles.length,
      unreadCount: articles.filter((a) => !a.readAt).length,
      starredCount: articles.filter((a) => a.starred).length,
      lastFetchedAt,
      lastAttemptAt,
      lastError,
      consecutiveFailures,
      status,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugFromPath(codocPath: CodocPath): string {
  const filename = String(codocPath).split("/").pop() ?? "";
  return filename.replace(/\.codoc$/, "");
}

/**
 * Generate codoc content for a new RSS source subscription.
 */
export function generateSourceCodoc(opts: {
  title: string;
  feedUrl: string;
  whyFollow: string;
  slug: string;
  intervalMinutes: number;
}): string {
  // Build YAML frontmatter manually to avoid deps.
  const lines = [
    "---",
    `title: "${opts.title}"`,
    `tags: [source, rss]`,
    `description: "${opts.feedUrl}"`,
    `data:`,
    `  title: "${opts.title}"`,
    `  feedUrl: "${opts.feedUrl}"`,
    `  whyFollow: "${opts.whyFollow}"`,
    `  articles:`,
    `    $source: rss`,
    `    url: "${opts.feedUrl}"`,
    `    interval: ${opts.intervalMinutes}`,
    "---",
    "",
    `<FeedHeader`,
    `  title={data.title}`,
    `  url={data.feedUrl}`,
    `  articleCount={(data.articles ?? []).length}`,
    `  unreadCount={(data.articles ?? []).filter(a => !a.readAt).length}`,
    `  refreshMinutes={${opts.intervalMinutes}}`,
    `  description={data.whyFollow}`,
    `/>`,
    "",
    `<ArticleList items={data.articles ?? []} codocPath="sources/${opts.slug}.codoc" fieldName="articles" />`,
    "",
  ];
  return lines.join("\n");
}
