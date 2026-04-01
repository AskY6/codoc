import type { ChatEvent, ChatInput, CobookService, ParsedCodoc } from "@cobook/service";
import { stringify as stringifyYaml } from "yaml";

import type { BaseAgent } from "./base-agent.js";

interface SceneAgentSessionState {
  activeSceneId: string | null;
  state: Record<string, unknown>;
}

interface SceneAgent {
  id: string;
  shouldHandle(
    input: ChatInput,
    service: CobookService,
    session: SceneAgentSessionState
  ): Promise<boolean>;
  run(
    input: ChatInput,
    service: CobookService,
    session: SceneAgentSessionState
  ): AsyncIterable<ChatEvent>;
}

interface RssSceneState {
  pendingStep?: "awaiting_feed_url";
}

interface RssArticleRecord {
  title?: string;
  link?: string;
  description?: string;
  publishedAt?: string;
  id?: string;
}

export class RouterAgent implements BaseAgent {
  readonly #fallback: BaseAgent;
  readonly #scenes: Map<string, SceneAgent>;

  constructor(fallback: BaseAgent, scenes: SceneAgent[]) {
    this.#fallback = fallback;
    this.#scenes = new Map(scenes.map((scene) => [scene.id, scene]));
  }

  async *run(input: ChatInput, service: CobookService): AsyncIterable<ChatEvent> {
    const sessionId = normalizeSessionId(input.sessionId);
    const session = await this.getSession(sessionId, service);
    const route = await this.pickScene(input, service, session);

    if (route) {
      session.activeSceneId = route.id;
      yield* route.run(input, service, session);
      await service.writeAgentSession({
        sessionId,
        activeSceneId: session.activeSceneId,
        state: session.state
      });
      return;
    }

    session.activeSceneId = null;
    session.state = {};
    await service.clearAgentSession(sessionId);
    yield* this.#fallback.run(input, service);
  }

  private async getSession(
    sessionId: string,
    service: CobookService
  ): Promise<SceneAgentSessionState> {
    const existing = await service.readAgentSession(sessionId);
    return {
      activeSceneId: existing?.activeSceneId ?? null,
      state: existing?.state ?? {}
    };
  }

  private async pickScene(
    input: ChatInput,
    service: CobookService,
    session: SceneAgentSessionState
  ): Promise<SceneAgent | null> {
    const workspace = await service.getWorkspace();
    const enabledSceneIds = new Set(Object.keys(workspace.config.agents ?? {}));

    const preferred = input.agentId?.trim();
    if (preferred && enabledSceneIds.has(preferred) && this.#scenes.has(preferred)) {
      return this.#scenes.get(preferred) ?? null;
    }

    const orderedSceneIds = uniqueStrings([
      ...(session.activeSceneId ? [session.activeSceneId] : []),
      ...enabledSceneIds
    ]);
    for (const sceneId of orderedSceneIds) {
      if (!enabledSceneIds.has(sceneId)) {
        continue;
      }

      const scene = this.#scenes.get(sceneId);
      if (!scene) {
        continue;
      }

      if (await scene.shouldHandle(input, service, session)) {
        return scene;
      }
    }

    return null;
  }
}

export class RssSceneAgent implements SceneAgent {
  readonly id = "rss";

  async shouldHandle(
    input: ChatInput,
    service: CobookService,
    session: SceneAgentSessionState
  ): Promise<boolean> {
    const state = readSceneState<RssSceneState>(session, this.id);
    if (state.pendingStep === "awaiting_feed_url") {
      return true;
    }

    const activeCodoc = input.activeCodocId
      ? await tryReadCodoc(service, input.activeCodocId)
      : null;
    return (
      looksLikeRssIntent(input.message) ||
      Boolean(input.selectedResourceId) ||
      isRssSceneCodoc(activeCodoc) ||
      session.activeSceneId === this.id
    );
  }

  async *run(
    input: ChatInput,
    service: CobookService,
    session: SceneAgentSessionState
  ): AsyncIterable<ChatEvent> {
    const message = input.message.trim();
    const feedUrl = extractFeedUrl(message);
    const state = readSceneState<RssSceneState>(session, this.id);

    if (state.pendingStep === "awaiting_feed_url" && feedUrl) {
      yield* this.createSubscription(feedUrl, service, session);
      return;
    }

    if (looksLikeRssIntent(message) && !feedUrl) {
      writeSceneState<RssSceneState>(session, this.id, {
        pendingStep: "awaiting_feed_url"
      });
      yield {
        kind: "status",
        status: "reading",
        message: "Collecting the RSS feed URL."
      };
      yield {
        kind: "message",
        content:
          "可以。把 RSS/Atom 源链接直接发给我，我会先帮你接入这个源，再生成一个可浏览条目列表的 source 文档。接入后，你点开这个源并选中某个条目，就可以继续在 chat 里讨论它。"
      };
      yield doneEvent();
      return;
    }

    if (feedUrl) {
      yield* this.createSubscription(feedUrl, service, session);
      return;
    }

    const activeCodoc = input.activeCodocId
      ? await tryReadCodoc(service, input.activeCodocId)
      : null;
    if (activeCodoc && isRssSceneCodoc(activeCodoc)) {
      const selection = await resolveSelectedArticle(service, activeCodoc.id, {
        message,
        ...(input.selectedResourceId ? { selectedResourceId: input.selectedResourceId } : {})
      });
      if (selection) {
        clearSceneState(session, this.id);
        yield {
          kind: "status",
          status: "reading",
          message: `Discussing item "${selection.title ?? selection.id ?? "selected"}".`
        };
        yield {
          kind: "message",
          content: formatArticleDiscussion(selection)
        };
        yield doneEvent();
        return;
      }

      const articles = await resolveRssArticles(service, activeCodoc.id);
      if (articles.length > 0) {
        clearSceneState(session, this.id);
        yield {
          kind: "status",
          status: "reading",
          message: `Reading items from "${activeCodoc.id}".`
        };
        yield {
          kind: "message",
          content: [
            `当前源 "${activeCodoc.id}" 有 ${articles.length} 个条目。`,
            "你可以点选其中一个条目，再继续问我“这个条目讲了什么”或“帮我提炼重点”。",
            "最近条目：",
            ...articles.slice(0, 5).map((article, index) =>
              `${index + 1}. ${article.title ?? article.id ?? "Untitled"}`
            )
          ].join("\n")
        };
        yield doneEvent();
        return;
      }
    }

    clearSceneState(session, this.id);
    yield {
      kind: "status",
      status: "reading",
      message: "Waiting for RSS source context."
    };
    yield {
      kind: "message",
      content:
        "我可以继续处理 RSS 场景。你可以直接发一个 RSS/Atom 链接，或者先点开某个 source 文档并选中一个条目，再继续讨论。"
    };
    yield doneEvent();
  }

  private async *createSubscription(
    feedUrl: string,
    service: CobookService,
    session: SceneAgentSessionState
  ): AsyncIterable<ChatEvent> {
    const workspace = await service.getWorkspace();
    const existingIds = new Set(workspace.codocs.map((codoc) => codoc.id));
    const codocId = buildUniqueCodocId(feedUrl, existingIds);
    const title = buildFeedTitle(feedUrl);
    const content = buildRssSourceCodoc(codocId, title, feedUrl);

    yield {
      kind: "status",
      status: "writing",
      message: `Subscribing "${feedUrl}".`
    };

    const result = await service.writeCodoc({
      codocId,
      filePath: `rss/${codocId}.codoc`,
      content,
      overwrite: false
    });

    clearSceneState(session, this.id);
    session.activeSceneId = this.id;

    yield {
      kind: "artifact",
      filePath: result.filePath
    };
    yield {
      kind: "message",
      content: [
        `已接入 RSS 源：${feedUrl}`,
        `我创建了 source 文档 "${codocId}"。你现在点开它就能看到条目列表。`,
        "接下来你可以选中某个条目，再继续问我“这个条目讲了什么”或“帮我提炼重点”。"
      ].join("\n")
    };
    yield doneEvent();
  }
}

async function tryReadCodoc(service: CobookService, codocId: string): Promise<ParsedCodoc | null> {
  try {
    return await service.readCodoc(codocId);
  } catch {
    return null;
  }
}

function looksLikeRssIntent(message: string): boolean {
  return /(rss|feed|atom|订阅|订阅源|源地址|文章源)/i.test(message);
}

function extractFeedUrl(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0] ?? null;
}

function isRssSceneCodoc(codoc: ParsedCodoc | null): boolean {
  if (!codoc || typeof codoc.meta !== "object" || codoc.meta === null) {
    return false;
  }

  const scene = "scene" in codoc.meta ? codoc.meta.scene : null;
  return (
    typeof scene === "object" &&
    scene !== null &&
    "kind" in scene &&
    scene.kind === "rss-source"
  );
}

function buildUniqueCodocId(feedUrl: string, existingIds: Set<string>): string {
  const url = new URL(feedUrl);
  const base = `${url.hostname}-${url.pathname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-feed$/, "")
    .slice(0, 48) || "rss-source";

  if (!existingIds.has(base)) {
    return base;
  }

  let index = 2;
  while (existingIds.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function buildFeedTitle(feedUrl: string): string {
  const url = new URL(feedUrl);
  const candidate = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  return candidate.replace(/\/+$/, "");
}

function buildRssSourceCodoc(codocId: string, title: string, feedUrl: string): string {
  return stringifyYaml(
    {
      codoc: "0.1",
      id: codocId,
      meta: {
        scene: {
          kind: "rss-source",
          sourceUrl: feedUrl
        },
        selection: {
          mode: "table-row",
          idKey: "id",
          titleKey: "title",
          descriptionKey: "description",
          urlKey: "link"
        }
      },
      data: {
        source: {
          title,
          url: feedUrl
        },
        items: {
          $source: "rss",
          url: feedUrl,
          limit: 20
        }
      },
      view: {
        type: "stack",
        gap: "md",
        children: [
          {
            type: "section",
            eyebrow: "RSS Source",
            title: "{data.source.title}",
            gap: "sm",
            children: [
              {
                type: "text",
                tone: "muted",
                content: "{data.source.url}"
              }
            ]
          },
          {
            type: "table",
            title: "Items",
            columns: [
              {
                key: "title",
                label: "Title"
              },
              {
                key: "publishedAt",
                label: "Published"
              },
              {
                key: "description",
                label: "Summary"
              }
            ],
            rows: "{data.items}"
          }
        ]
      }
    },
    {
      lineWidth: 0
    }
  );
}

async function resolveRssArticles(
  service: CobookService,
  codocId: string
): Promise<RssArticleRecord[]> {
  const resolved = await service.resolve(`${codocId}:data`);
  const value =
    typeof resolved.value === "object" && resolved.value !== null && "items" in resolved.value
      ? resolved.value.items
      : null;

  return Array.isArray(value) ? (value as RssArticleRecord[]) : [];
}

async function resolveSelectedArticle(
  service: CobookService,
  codocId: string,
  input: {
    selectedResourceId?: string;
    message: string;
  }
): Promise<RssArticleRecord | null> {
  const items = await resolveRssArticles(service, codocId);
  if (items.length === 0) {
    return null;
  }

  if (input.selectedResourceId) {
    const byId = items.find((item) => item.id === input.selectedResourceId);
    if (byId) {
      return byId;
    }
  }

  const ordinal = extractOrdinalSelection(input.message);
  if (ordinal !== null && items[ordinal]) {
    return items[ordinal];
  }

  const lower = input.message.toLowerCase();
  return items.find((item) => item.title && lower.includes(item.title.toLowerCase())) ?? null;
}

function extractOrdinalSelection(message: string): number | null {
  const chineseMatch = message.match(/第\s*([0-9]+)\s*(篇|个)/);
  if (chineseMatch?.[1]) {
    return Math.max(0, Number.parseInt(chineseMatch[1], 10) - 1);
  }

  const englishMatch = message.match(/\b(article|item)\s+([0-9]+)\b/i);
  if (englishMatch?.[2]) {
    return Math.max(0, Number.parseInt(englishMatch[2], 10) - 1);
  }

  return null;
}

function formatArticleDiscussion(article: RssArticleRecord): string {
  const title = article.title ?? article.id ?? "Untitled item";
  const summary = article.description?.trim() || "这个条目没有提供摘要。";

  return [
    `正在讨论：《${title}》`,
    article.publishedAt ? `发布时间：${article.publishedAt}` : null,
    article.link ? `原文链接：${article.link}` : null,
    "",
    "摘要：",
    summary,
    "",
    "可以继续让我做：",
    "1. 提炼这个条目的核心观点",
    "2. 结合当前上下文讨论它为什么重要",
    "3. 把这个条目整理成新的 note/digest codoc"
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function doneEvent(): ChatEvent {
  return {
    kind: "status",
    status: "done"
  };
}

function normalizeSessionId(sessionId: string | undefined): string {
  const normalized = sessionId?.trim();
  return normalized && normalized.length > 0 ? normalized : "__default__";
}

function readSceneState<T extends object>(
  session: SceneAgentSessionState,
  sceneId: string
): T {
  const raw = session.state[sceneId];
  return typeof raw === "object" && raw !== null ? (raw as T) : ({} as T);
}

function writeSceneState<T extends object>(
  session: SceneAgentSessionState,
  sceneId: string,
  state: T
): void {
  session.state = {
    ...session.state,
    [sceneId]: state
  };
}

function clearSceneState(session: SceneAgentSessionState, sceneId: string): void {
  const next = {
    ...session.state
  };
  delete next[sceneId];
  session.state = next;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}
