import Parser from "rss-parser";
import { parseYaml, stringifyYaml } from "@cobook/core";
import type { WorkspaceService, CodocRepository, WorkspaceRepository } from "@cobook/service";

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

export function createRssScheduler(deps: {
  service: WorkspaceService;
  codocRepo: CodocRepository;
  workspaceRepo: WorkspaceRepository;
}) {
  const { service, codocRepo, workspaceRepo } = deps;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function refreshAllFeeds() {
    const workspaces = await workspaceRepo.list();

    for (const ws of workspaces) {
      const codocs = await service.listCodocs(ws.id);
      const rssFeeds = codocs.filter(
        (c) =>
          c.path.startsWith("rss/") &&
          c.meta.tags?.includes("rss") &&
          !c.meta.tags?.includes("dashboard"),
      );

      for (const feed of rssFeeds) {
        try {
          await refreshFeed(ws.id, feed.path, feed.meta.description);
        } catch (err) {
          console.error(`[rss-scheduler] Failed to refresh ${feed.path}:`, err);
        }
      }
    }
  }

  async function refreshFeed(
    workspaceId: string,
    path: string,
    feedUrl: string | undefined,
  ) {
    if (!feedUrl) return;

    const row = await codocRepo.findByPath(workspaceId, path);
    if (!row) return;

    const doc = parseYaml(row.content) as Record<string, unknown>;
    const data = doc["data"] as Record<string, unknown> | undefined;
    if (!data) return;

    const lastFetchedAt = data["lastFetchedAt"] as string | undefined;
    const refreshInterval =
      (data["refreshIntervalMinutes"] as number | undefined) ??
      DEFAULT_REFRESH_MINUTES;

    // Check if refresh is needed
    if (lastFetchedAt) {
      const nextRefresh =
        new Date(lastFetchedAt).getTime() + refreshInterval * 60 * 1000;
      if (Date.now() < nextRefresh) return;
    }

    // Fetch feed
    const parsed = await rssParser.parseURL(feedUrl);
    const existingArticles = (data["articles"] as Article[] | undefined) ?? [];

    // Build a map of existing articles by link for preserving readAt
    const existingByLink = new Map<string, Article>();
    for (const a of existingArticles) {
      if (a.link) existingByLink.set(a.link, a);
    }

    // Merge: new articles get readAt:null, existing keep their readAt
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

    data["articles"] = merged;
    data["lastFetchedAt"] = new Date().toISOString();

    const newContent = stringifyYaml(doc);
    await service.updateCodoc(workspaceId, path, newContent);

    const newCount = merged.filter((a) => !existingByLink.has(a.link)).length;
    if (newCount > 0) {
      console.log(
        `[rss-scheduler] ${path}: ${newCount} new article(s)`,
      );
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
