import { stringify } from "yaml";
import type { WorkspacePresetDefinition } from "../types.js";

function mdxCodoc(
  frontmatter: { meta?: Record<string, unknown>; data?: Record<string, unknown> },
  body: string,
): string {
  const fm = stringify(frontmatter).trim();
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

interface FeedPreset {
  slug: string;
  title: string;
  url: string;
  whyFollow: string;
}

const feedPresets: FeedPreset[] = [
  {
    slug: "openai",
    title: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    whyFollow: "Model launches, platform capabilities, and product direction from a primary source.",
  },
  {
    slug: "github-engineering",
    title: "GitHub Engineering",
    url: "https://github.blog/engineering/feed/",
    whyFollow: "High-signal writeups on developer tooling, reliability, AI workflows, and systems that many builders actually use.",
  },
  {
    slug: "simon-willison",
    title: "Simon Willison",
    url: "https://simonwillison.net/atom/everything/",
    whyFollow: "One of the fastest and clearest sources for model releases, MCP, tools, and practical LLM engineering patterns.",
  },
];

function createLandingCodoc(): { path: string; content: string } {
  return {
    path: "ai-dev-radar.codoc",
    content: mdxCodoc(
      {
        meta: {
          title: "AI & Dev Radar",
          description: "A preset workspace that demonstrates Cobook with a curated, ready-to-browse RSS pack.",
          tags: ["preset", "rss", "overview"],
        },
        data: {
          metrics: [
            { label: "Feeds", value: feedPresets.length, detail: "live sources" },
            { label: "Fetch mode", value: "Live", detail: "pulled on apply" },
            { label: "Views", value: 2, detail: "feed + dashboard" },
            { label: "Guide", value: 1, detail: "orientation note" },
          ],
          feeds: feedPresets.map((feed) => ({
            feed: feed.title,
            path: `rss/${feed.slug}.codoc`,
            why: feed.whyFollow,
          })),
          nextActions: [
            { action: "Open the dashboard", path: "rss/dashboard.codoc", why: "See all feeds merged into one ranked stream." },
            { action: "Open a single feed", path: `rss/${feedPresets[0]!.slug}.codoc`, why: "Inspect a live feed with read and unread tracking." },
            { action: "Read the guide", path: "notes/how-to-use-this-radar.codoc", why: "Understand how to turn live articles into durable knowledge." },
          ],
        },
      },
      `
<Callout type="success" title="Preset loaded">
  This workspace pulls real RSS sources when the preset is applied. What you see should come from live feeds, not hardcoded sample posts.
</Callout>

<MetricBar items={data.metrics ?? []} />

<Section title="Included feeds">
  <DataTable rows={data.feeds ?? []} />
</Section>

<Section title="Try these first">
  <DataTable rows={data.nextActions ?? []} />
</Section>

<Navigate to="rss/dashboard.codoc">
  <Callout title="Open the dashboard">
    The dashboard merges all configured feeds into one stream so the workspace becomes useful as soon as the live fetch completes.
  </Callout>
</Navigate>
`,
    ),
  };
}

function createFeedCodoc(feed: FeedPreset): { path: string; content: string } {
  return {
    path: `rss/${feed.slug}.codoc`,
    content: mdxCodoc(
      {
        meta: {
          title: feed.title,
          tags: ["rss"],
          description: feed.url,
        },
        data: {
          feedTitle: feed.title,
          feedUrl: feed.url,
          lastFetchedAt: null,
          refreshIntervalMinutes: 60,
          whyFollow: feed.whyFollow,
          articles: [],
        },
      },
      `
export const metrics = [
  { label: "Articles", value: data.articles?.length ?? 0 },
  { label: "Unread", value: data.articles?.filter(article => !article.readAt).length ?? 0 },
  { label: "Refresh", value: \`\${data.refreshIntervalMinutes}m\` },
]

<MetricBar items={metrics} />

<Callout title="Live source">
  This feed is fetched in real time when the preset is applied, then refreshed periodically afterwards.
</Callout>

<Section title="Why keep this feed in your radar">
  <MarkdownContent content={data.whyFollow} />
</Section>

<ArticleList
  items={data.articles ?? []}
  itemAction={(item, i) => ({
    type: "chat",
    prompt: \`summarize [\${item.title}](\${item.link})\`,
    meta: { patchPath: \`articles[\${i}].readAt\` },
  })}
/>
`,
    ),
  };
}

function createDashboardCodoc(): { path: string; content: string } {
  return {
    path: "rss/dashboard.codoc",
    content: mdxCodoc(
      {
        meta: {
          title: "AI & Dev Radar Dashboard",
          tags: ["rss", "dashboard"],
          description: "Merged view of the seeded AI and engineering feeds.",
        },
        data: {
          openAIArticles: {
            $ref: "./openai.codoc#data.articles",
          },
          githubEngineeringArticles: {
            $ref: "./github-engineering.codoc#data.articles",
          },
          simonArticles: {
            $ref: "./simon-willison.codoc#data.articles",
          },
        },
      },
      `
export const allArticles = [
  ...(data.openAIArticles ?? []).map(article => ({ ...article, feedTitle: "OpenAI News" })),
  ...(data.githubEngineeringArticles ?? []).map(article => ({ ...article, feedTitle: "GitHub Engineering" })),
  ...(data.simonArticles ?? []).map(article => ({ ...article, feedTitle: "Simon Willison" })),
].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

export const metrics = [
  { label: "Feeds", value: 3 },
  { label: "Articles", value: allArticles.length },
  { label: "Unread", value: allArticles.filter(article => !article.readAt).length },
]

export const feedStats = [
  { feed: "OpenAI News", unread: (data.openAIArticles ?? []).filter(article => !article.readAt).length, path: "rss/openai.codoc" },
  { feed: "GitHub Engineering", unread: (data.githubEngineeringArticles ?? []).filter(article => !article.readAt).length, path: "rss/github-engineering.codoc" },
  { feed: "Simon Willison", unread: (data.simonArticles ?? []).filter(article => !article.readAt).length, path: "rss/simon-willison.codoc" },
]

<MetricBar items={metrics} />

<Callout title="Why this preset works">
  You are looking at the same live content through two shapes: individual feed codocs and a derived dashboard codoc. That is the core Cobook loop.
</Callout>

<Section title="Latest across all feeds">
  <ArticleList
    items={allArticles}
    itemAction={(item) => ({
      type: "chat",
      prompt: \`summarize [\${item.title}](\${item.link})\`,
    })}
  />
</Section>

<Section title="Feed status">
  <DataTable rows={feedStats} />
</Section>
`,
    ),
  };
}

function createGuideCodoc(): { path: string; content: string } {
  return {
    path: "notes/how-to-use-this-radar.codoc",
    content: mdxCodoc(
      {
        meta: {
          title: "How to use AI & Dev Radar",
          tags: ["preset", "guide"],
          description: "A quick orientation note for the live RSS starter workspace.",
        },
        data: {
          sections: [
            {
              title: "1. The feeds are live",
              body: "When you apply this preset, Cobook immediately pulls the configured RSS feeds so the workspace starts with real articles instead of mock content.",
            },
            {
              title: "2. The dashboard is derived",
              body: "Each feed stays independent, but the dashboard codoc merges them into a single ranked stream. That shows how one workspace can hold both source nodes and derived nodes.",
            },
            {
              title: "3. The chat loop is the value",
              body: "Open an article, ask an agent to summarize it, and turn the useful result into a new codoc. That is how transient reading becomes durable workspace knowledge.",
            },
          ],
        },
      },
      `
<Section title="How to use this radar">
  <DataTable rows={data.sections ?? []} />
</Section>
`,
    ),
  };
}

export function buildAiDevRadarPreset(): WorkspacePresetDefinition {
  return {
    id: "ai-dev-radar",
    name: "AI & Dev Radar",
    description: "A curated AI and engineering reading workspace with live RSS feeds and a merged dashboard.",
    defaultWorkspaceName: "AI & Dev Radar",
    workspaceDescription: "Preset workspace generated from the AI & Dev Radar starter pack.",
    tags: ["rss", "starter", "research"],
    highlights: [
      "Three high-signal RSS feeds fetched live when the preset is applied",
      "A derived dashboard codoc that merges multiple sources",
      "A guide codoc that explains how to turn live articles into knowledge",
    ],
    agentOptions: [
      { id: "base", selectedByDefault: true },
      { id: "rss", selectedByDefault: true },
      { id: "claude-code-log" },
    ],
    featured: true,
    codocs: [
      createLandingCodoc(),
      ...feedPresets.map(createFeedCodoc),
      createDashboardCodoc(),
      createGuideCodoc(),
    ],
  };
}
