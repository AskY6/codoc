// RSS Reader template — AI-first RSS workspace.
//
// The user's main surface is inbox.codoc (agent-generated digest),
// not individual feed pages. Feed definitions live under sources/
// as data for the agent. topics/ holds agent-generated research notes.

import type { Template, TemplateFile } from "../../../src/templates/types.js";
import { serializeYaml } from "../../../src/templates/yaml.js";
import articleListSource from "raw:../components/ArticleList.tsx";
import feedHeaderSource from "raw:../components/FeedHeader.tsx";
import sourceBadgeSource from "raw:../components/SourceBadge.tsx";
import digestStatsSource from "raw:../components/DigestStats.tsx";
import digestTopSource from "raw:../components/DigestTop.tsx";
import digestListSource from "raw:../components/DigestList.tsx";
import digestTrendingSource from "raw:../components/DigestTrending.tsx";

function codoc(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const yaml = serializeYaml(frontmatter, 0);
  return `---\n${yaml}---\n\n${body.trim()}\n`;
}

interface Feed {
  slug: string;
  title: string;
  url: string;
  why: string;
}

const feeds: Feed[] = [
  {
    slug: "hacker-news",
    title: "Hacker News",
    url: "https://hnrss.org/frontpage",
    why: "Top stories from the developer community — broad signal across engineering, startups, and tools.",
  },
  {
    slug: "simon-willison",
    title: "Simon Willison",
    url: "https://simonwillison.net/atom/everything/",
    why: "One of the fastest and clearest sources for model releases, MCP, tools, and practical LLM engineering patterns.",
  },
  {
    slug: "github-engineering",
    title: "GitHub Engineering",
    url: "https://github.blog/engineering/feed/",
    why: "High-signal writeups on developer tooling, reliability, AI workflows, and systems that many builders actually use.",
  },
];

// ---------------------------------------------------------------------------
// Codoc files
// ---------------------------------------------------------------------------

/** inbox.codoc — the user's primary reading surface. */
function inboxCodoc(): TemplateFile {
  return {
    path: "inbox.codoc",
    content: codoc(
      {
        title: "Inbox",
        tags: ["inbox"],
        description: "AI-curated digest from your RSS sources.",
        data: {
          lastDigestAt: null,
          highlights: [],
          trending: [],
        },
      },
      `\
{(data.highlights ?? []).length === 0 ? (
  <Card title="No digest yet" description="Refresh feeds and update digest to get started." />
) : (
  <>
    {data.lastDigestAt && (Date.now() - new Date(data.lastDigestAt).getTime() > 24 * 60 * 60 * 1000) && (
      <Card title="Digest may be stale" description={\`Last updated \${new Date(data.lastDigestAt).toLocaleDateString()}. Update digest to refresh this inbox.\`} />
    )}
    <DigestStats highlights={data.highlights ?? []} trending={data.trending ?? []} lastDigestAt={data.lastDigestAt} />
    <DigestTop items={data.highlights ?? []} count={3} />
    <DigestList items={data.highlights ?? []} skip={3} />
    <DigestTrending items={data.trending ?? []} />
  </>
)}`,
    ),
  };
}

/** sources/<slug>.codoc — feed definition (data layer, not primary UI). */
function sourceCodoc(feed: Feed): TemplateFile {
  return {
    path: `sources/${feed.slug}.codoc`,
    content: codoc(
      {
        title: feed.title,
        tags: ["source", "rss"],
        description: feed.url,
        data: {
          title: feed.title,
          feedUrl: feed.url,
          whyFollow: feed.why,
          articles: {
            $source: "rss",
            url: feed.url,
            interval: 30,
          },
        },
      },
      `\
<FeedHeader
  title={data.title}
  url={data.feedUrl}
  articleCount={(data.articles ?? []).length}
  unreadCount={(data.articles ?? []).filter(a => !a.readAt).length}
  refreshMinutes={30}
  description={data.whyFollow}
/>

<ArticleList items={data.articles ?? []} codocPath="sources/${feed.slug}.codoc" fieldName="articles" />`,
    ),
  };
}

function guideCodoc(): TemplateFile {
  return {
    path: "guide.codoc",
    content: codoc(
      {
        title: "Guide",
        tags: ["guide"],
        description: "How this workspace works.",
      },
      `\
This is an AI-first RSS workspace. You don't browse feeds — you ask the agent.

## Try these

<Prompt label="What's new today?" />
<Prompt label="Deep dive into AI agents" />
<Prompt label="Refresh all feeds" />
<Prompt label="Subscribe to https://example.com/feed" />
<Prompt label="Summarize the latest from Hacker News" />

## Structure

- **inbox.codoc** — your main view. The agent writes digests here.
- **sources/** — feed definitions. The agent reads these to know where to fetch.
- **topics/** — research notes. The agent writes deep dives here.`,
    ),
  };
}

export const rssTemplate: Template = {
  id: "rss",
  name: "RSS Reader",
  description: "AI-first RSS — ask the agent for digests, deep dives, and research across your feeds.",
  components: ["Card", "DigestStats", "DigestTop", "DigestList", "DigestTrending"],

  // R1: Domain commands
  commands: [
    { name: "refresh", description: "Fetch latest articles from all feeds",
      prompt: "Refresh all my RSS feeds and tell me what's new." },
    { name: "digest", description: "Generate today's digest in inbox",
      prompt: "Read all sources, pick highlights, and update my inbox digest." },
    { name: "subscribe", description: "Add a new RSS feed",
      prompt: "Subscribe to a new RSS feed: " },
    { name: "deepdive", description: "Research a topic across feeds",
      prompt: "Deep dive into: " },
  ],

  // R2: Domain quick actions
  quickActions: [
    { label: "What's new today?", prompt: "What's new today? Read my feeds, pick highlights, and update my inbox." },
    { label: "Refresh feeds", prompt: "Refresh all my RSS feeds." },
    { label: "Subscribe to...", prompt: "Subscribe to " },
  ],

  // R3: Agent instructions
  agentInstructions: `You are an AI RSS assistant. The workspace structure:
- sources/*.codoc: Each has data fields: title, feedUrl, whyFollow, articles (auto-refreshed via $source: rss with interval)
- inbox.codoc: Has data fields: highlights[], trending[], lastDigestAt
- Articles are fetched automatically by the scheduler every 30 minutes. You do NOT need to fetch feeds manually.

Workflows:
- DIGEST: Read all sources' articles where readAt is null (unread), select the most
  interesting as highlights, write to inbox.codoc highlights[] and trending[] via
  update_data_field, set lastDigestAt to now.
  Each highlight MUST follow this schema:
    { title: string, source: string, summary: string, link: string }
  The "summary" field is the most important — write a one-line explanation of why this
  article matters or what the reader will learn. Do NOT just repeat the title.
  Each trending item MUST follow:
    { title: string, source: string, summary: string }
- SUBSCRIBE: Create new sources/<slug>.codoc via create_from_template with:
  title, tags: ["source", "rss"], data: { title, feedUrl, whyFollow, articles: { $source: "rss", url, interval: 30 } },
  body: '<FeedHeader title={data.title} url={data.feedUrl} articleCount={(data.articles ?? []).length} unreadCount={(data.articles ?? []).filter(a => !a.readAt).length} refreshMinutes={30} description={data.whyFollow} />\n\n<ArticleList items={data.articles ?? []} />'.
  The scheduler will start fetching automatically.
- DEEP DIVE: Research a topic across all feed articles, create topics/<slug>.codoc
  with a structured summary.
- MARK READ: Use update_data_field on the articles field with the full articles array,
  setting readAt to an ISO timestamp on the target articles. The source declaration is
  preserved automatically — only the cached value is updated.

Rules:
- Articles auto-refresh — do not manually fetch RSS feeds.
- Always use update_data_field for field updates, not write_codoc (preserve MDX body).
- Mark articles as read by setting readAt to ISO timestamp.
- When generating a digest, every item MUST have a "summary" field — a concise insight
  about why the article is worth reading. This is the AI's value-add over raw feeds.
- IMPORTANT: When the user asks "what's new", "give me a digest", "today's highlights",
  or any variant — ALWAYS run the DIGEST workflow. This means you must call
  update_data_field to persist highlights into inbox.codoc, not just answer in text.
  The inbox is the user's primary reading surface; a text-only reply is insufficient.`,

  files() {
    return [
      // Components
      { path: "components/ArticleList.tsx", content: articleListSource },
      { path: "components/FeedHeader.tsx", content: feedHeaderSource },
      { path: "components/SourceBadge.tsx", content: sourceBadgeSource },
      { path: "components/DigestStats.tsx", content: digestStatsSource },
      { path: "components/DigestTop.tsx", content: digestTopSource },
      { path: "components/DigestList.tsx", content: digestListSource },
      { path: "components/DigestTrending.tsx", content: digestTrendingSource },
      // Codocs
      inboxCodoc(),
      ...feeds.map(sourceCodoc),
      guideCodoc(),
    ];
  },
};
