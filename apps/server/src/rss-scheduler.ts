import Parser from "rss-parser";
import type { CodocAST } from "@cobook/core";
import type { WorkspaceService } from "@cobook/service";

const rssParser = new Parser();
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
const DEFAULT_REFRESH_MINUTES = 60;

interface Article {
  title: string;
  link: string;
  pubDate: string;
  summary: string;
  readAt: string | null;
}

export interface FeedRefreshTarget {
  path: string;
  title: string;
  feedUrl: string;
}

export interface FeedRefreshResult extends FeedRefreshTarget {
  articleCount: number;
  newCount: number;
  status: "completed" | "failed";
  error?: string;
}

export function createRssScheduler(deps: { service: WorkspaceService }) {
  const { service } = deps;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function refreshAllFeeds() {
    const workspaces = await service.listWorkspaces();

    for (const ws of workspaces) {
      await refreshWorkspaceFeeds(service, ws.id);
    }
  }

  async function loop() {
    if (stopped) return;
    await refreshAllFeeds().catch((err) =>
      console.error("[rss-scheduler] Refresh failed:", err),
    );
    if (!stopped) {
      timer = setTimeout(loop, CHECK_INTERVAL_MS);
    }
  }

  function start() {
    stopped = false;
    loop();
    console.log(
      `[rss-scheduler] Started (checking every ${CHECK_INTERVAL_MS / 1000}s)`,
    );
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { start, stop };
}

export async function refreshWorkspaceFeeds(
  service: WorkspaceService,
  workspaceId: string,
  options?: {
    force?: boolean;
    onFeedStart?: (feed: FeedRefreshTarget) => void | Promise<void>;
    onFeedComplete?: (result: FeedRefreshResult) => void | Promise<void>;
    onFeedError?: (result: FeedRefreshResult) => void | Promise<void>;
  },
): Promise<FeedRefreshResult[]> {
  const codocs = await service.listCodocs(workspaceId);
  const rssFeeds = codocs.filter(
    (c) =>
      isTopLevelRssFeed(c.path) &&
      c.meta.tags?.includes("rss") &&
      typeof c.meta.description === "string" &&
      c.meta.description.startsWith("http"),
  );

  const results: FeedRefreshResult[] = [];

  for (const feed of rssFeeds) {
    const feedUrl = feed.meta.description;
    if (typeof feedUrl !== "string") continue;
    const target: FeedRefreshTarget = {
      path: feed.path,
      title: feed.meta.title ?? feed.path,
      feedUrl,
    };
    try {
      await options?.onFeedStart?.(target);
      const result = await refreshFeed(service, workspaceId, target, options);
      results.push(result);
      await options?.onFeedComplete?.(result);
    } catch (err) {
      const result: FeedRefreshResult = {
        ...target,
        articleCount: 0,
        newCount: 0,
        status: "failed",
        error: String(err),
      };
      results.push(result);
      console.error(`[rss-scheduler] Failed to refresh ${feed.path}:`, err);
      await options?.onFeedError?.(result);
    }
  }

  return results;
}

async function refreshFeed(
  service: WorkspaceService,
  workspaceId: string,
  target: FeedRefreshTarget,
  options?: { force?: boolean },
): Promise<FeedRefreshResult> {
  if (!target.feedUrl) {
    return {
      ...target,
      articleCount: 0,
      newCount: 0,
      status: "failed",
      error: "Missing feed URL",
    };
  }

  const codoc = await service.getCodoc(workspaceId, target.path);
  const ast = codoc?.ast;
  if (!ast?.data) {
    return {
      ...target,
      articleCount: 0,
      newCount: 0,
      status: "failed",
      error: "Missing codoc data",
    };
  }

  const configuredFeedUrl = getStaticDataValue(ast.data, "feedUrl");
  const effectiveFeedUrl =
    typeof configuredFeedUrl === "string" ? configuredFeedUrl : target.feedUrl;
  if (!effectiveFeedUrl) {
    return {
      ...target,
      articleCount: 0,
      newCount: 0,
      status: "failed",
      error: "Missing effective feed URL",
    };
  }

  const lastFetchedAt = getStaticDataValue(ast.data, "lastFetchedAt");
  const refreshInterval =
    (getStaticDataValue(ast.data, "refreshIntervalMinutes") as
      | number
      | undefined) ??
    DEFAULT_REFRESH_MINUTES;

  if (!options?.force && typeof lastFetchedAt === "string") {
    const nextRefresh =
      new Date(lastFetchedAt).getTime() + refreshInterval * 60 * 1000;
    if (Date.now() < nextRefresh) {
      return {
        ...target,
        articleCount: ((getStaticDataValue(ast.data, "articles") as Article[] | undefined) ?? [])
          .length,
        newCount: 0,
        status: "completed",
      };
    }
  }

  const parsed = await rssParser.parseURL(effectiveFeedUrl);
  const existingArticles =
    (getStaticDataValue(ast.data, "articles") as Article[] | undefined) ?? [];

  const existingByLink = new Map<string, Article>();
  for (const a of existingArticles) {
    if (a.link) existingByLink.set(a.link, a);
  }

  const merged: Article[] = parsed.items.map((item) => {
    const link = item.link ?? "";
    const existing = existingByLink.get(link);
    return {
      title: item.title ?? "",
      link,
      pubDate: item.pubDate ?? item.isoDate ?? "",
      summary: item.contentSnippet ?? item.content ?? "",
      readAt: existing?.readAt ?? null,
    };
  });

  await service.patchCodocData(workspaceId, target.path, "articles", merged);
  await service.patchCodocData(
    workspaceId,
    target.path,
    "lastFetchedAt",
    new Date().toISOString(),
  );

  const newCount = merged.filter((a) => !existingByLink.has(a.link)).length;
  if (newCount > 0) {
    console.log(`[rss-scheduler] ${target.path}: ${newCount} new article(s)`);
  }

  return {
    ...target,
    articleCount: merged.length,
    newCount,
    status: "completed",
  };
}

function isTopLevelRssFeed(path: string): boolean {
  if (!path.startsWith("rss/")) return false;
  return !path.slice("rss/".length).includes("/");
}

function getStaticDataValue(
  data: CodocAST["data"] | undefined,
  key: string,
): unknown {
  const field = data?.[key];
  return field?.kind === "static" ? field.value : undefined;
}
