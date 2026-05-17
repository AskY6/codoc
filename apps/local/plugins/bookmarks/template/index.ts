// Bookmarks template — AI-first web clipper.
//
// The user says "save <url>" and the agent creates a structured
// bookmark codoc. reading-list.codoc aggregates via $ref.

import type { Template, TemplateFile } from "../../../src/templates/types.js";
import { serializeYaml } from "../../../src/templates/yaml.js";
import bookmarkCardSource from "raw:./components/BookmarkCard.tsx";

function codoc(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const yaml = serializeYaml(frontmatter, 0);
  return `---\n${yaml}---\n\n${body.trim()}\n`;
}

interface Bookmark {
  slug: string;
  title: string;
  url: string;
  author: string;
  savedAt: string;
  tags: string[];
  summary: string;
  keyTakeaways: string[];
}

const seedBookmarks: Bookmark[] = [
  {
    slug: "prompt-caching",
    title: "Prompt Caching with Claude",
    url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
    author: "Anthropic",
    savedAt: "2026-04-20",
    tags: ["ai", "anthropic", "performance"],
    summary:
      "Prompt caching reduces latency by up to 85% and cost by up to 90% for long prompts by caching a prefix and reusing it across requests.",
    keyTakeaways: [
      "Cache breakpoints mark reusable prefix boundaries",
      "Minimum cacheable length is 1024 tokens",
      "Cache TTL is 5 minutes, refreshed on each hit",
    ],
  },
  {
    slug: "sqlite-on-the-edge",
    title: "SQLite on the Edge: Scaling Read-Heavy Workloads",
    url: "https://blog.turso.tech/sqlite-on-the-edge",
    author: "Turso",
    savedAt: "2026-04-18",
    tags: ["database", "sqlite", "edge"],
    summary:
      "Turso embeds libSQL (a SQLite fork) at edge locations, replicating from a primary. Read latency drops to single-digit ms without giving up SQL or ACID.",
    keyTakeaways: [
      "libSQL adds HTTP and replication to SQLite",
      "Embedded replicas give local reads with remote writes",
      "Fits use cases where reads vastly outnumber writes",
    ],
  },
  {
    slug: "fly-machine-api",
    title: "Machines API v2: Orchestrating Containers at the Edge",
    url: "https://fly.io/blog/machine-api-v2/",
    author: "Fly.io",
    savedAt: "2026-04-15",
    tags: ["infra", "containers", "edge"],
    summary:
      "Fly's Machine API v2 lets you start, stop, and configure containers in any region with a single REST call — no orchestrator layer needed.",
    keyTakeaways: [
      "Machines are the primitive — not pods, services, or tasks",
      "Cold start under 300ms for most images",
      "Auto-stop on idle saves cost without sacrificing availability",
    ],
  },
];

// ---------------------------------------------------------------------------
// Codoc files
// ---------------------------------------------------------------------------

function bookmarkCodoc(bm: Bookmark): TemplateFile {
  return {
    path: `bookmarks/${bm.slug}.codoc`,
    content: codoc(
      {
        title: bm.title,
        tags: bm.tags,
        description: bm.url,
        data: {
          title: bm.title,
          url: bm.url,
          author: bm.author,
          savedAt: bm.savedAt,
          status: "unread",
          tags: bm.tags,
          summary: bm.summary,
          keyTakeaways: bm.keyTakeaways,
        },
      },
      `\
<BookmarkCard
  title={data.title}
  url={data.url}
  author={data.author}
  savedAt={data.savedAt}
  status={data.status}
  summary={data.summary}
  tags={data.tags}
/>

## Key Takeaways

<Table data={(data.keyTakeaways ?? []).map(t => ({ point: t }))} />`,
    ),
  };
}

function readingListCodoc(): TemplateFile {
  return {
    path: "reading-list.codoc",
    content: codoc(
      {
        title: "Reading List",
        tags: ["dashboard"],
        description: "All bookmarks at a glance.",
        data: {
          pcStatus: { $ref: "./bookmarks/prompt-caching.codoc#data.status" },
          seStatus: { $ref: "./bookmarks/sqlite-on-the-edge.codoc#data.status" },
          fmStatus: { $ref: "./bookmarks/fly-machine-api.codoc#data.status" },
        },
      },
      `\
export const bookmarks = [
  { title: "${seedBookmarks[0]!.title}", status: data.pcStatus ?? "unread" },
  { title: "${seedBookmarks[1]!.title}", status: data.seStatus ?? "unread" },
  { title: "${seedBookmarks[2]!.title}", status: data.fmStatus ?? "unread" },
]

<Card title="Reading List" value={bookmarks.length} description={\`\${bookmarks.filter(b => b.status !== "read").length} unread\`} />

<Table data={bookmarks} />`,
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
        data: {
          prompts: [
            { prompt: "save https://...", what: "Agent fetches the page, extracts key info, creates a bookmark codoc" },
            { prompt: "summarize [bookmark]", what: "Agent reads the original article and enriches the codoc" },
            { prompt: "what did I save about [topic]?", what: "Agent searches your bookmarks and summarizes findings" },
            { prompt: "mark [bookmark] as read", what: "Agent updates the bookmark status" },
          ],
        },
      },
      `\
This is an AI-first bookmarks workspace. You say "save [url]" and the agent does the rest.

## Try these

<Table data={data.prompts ?? []} />

## Structure

- **reading-list.codoc** — dashboard with all bookmarks, uses $ref to pull status from each.
- **bookmarks/** — one codoc per saved URL, with structured summary and takeaways.`,
    ),
  };
}

export const bookmarksTemplate: Template = {
  id: "bookmarks",
  name: "Bookmarks",
  description: "AI-first web clipper — say 'save [url]' and the agent creates structured knowledge cards.",
  components: ["Table", "Card"],
  files() {
    return [
      // Component
      { path: "components/BookmarkCard.tsx", content: bookmarkCardSource },
      // Codocs
      ...seedBookmarks.map(bookmarkCodoc),
      readingListCodoc(),
      guideCodoc(),
    ];
  },
};
