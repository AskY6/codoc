// chat-route — SSE endpoint that proxies user messages to a CLI provider.
//
// POST /api/chat  { provider, prompt, sessionId?, mentions?, images? }
//   → text/event-stream of JSON-encoded ChatEvent envelopes
//
// The provider field selects which CLI backend to use (claude-code, codex, kiro).
// Once a conversation starts with a provider, it stays with that provider.

import { Hono } from "hono";
import type { Workspace } from "../domain/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ChatEvent } from "../providers/types.js";
import type { WorkspacePlugin, WorkspacePluginContext } from "../plugins/types.js";
import { upsertChatMeta } from "./chat-meta.js";

// Re-export ChatEvent for backward compatibility
export type { ChatEvent } from "../providers/types.js";

interface ImagePayload {
  dataUrl: string;
  name: string;
}

export function createChatRoutes(
  state: {
    workspace: Workspace | null;
    activePlugin: WorkspacePlugin | null;
    pluginCtx: WorkspacePluginContext | null;
  },
  registry: ProviderRegistry,
): Hono {
  const app = new Hono();

  app.post("/chat", async (c) => {
    if (!state.workspace) {
      return c.json({ error: "no workspace open" }, 503);
    }

    const sourceDir = state.workspace.sourceDir;

    const body = await c.req.json<{
      provider?: string;
      prompt: string;
      sessionId?: string;
      mentions?: string[];
      images?: ImagePayload[];
    }>();

    const { prompt, sessionId } = body;
    const providerId = body.provider ?? "claude-code";
    const images = body.images ?? [];
    const mentions = (body.mentions ?? []).map((m) =>
      m.replace(/\.mdx$/, ".codoc"),
    );

    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    // Look up the provider
    const provider = registry.get(providerId);
    if (!provider) {
      return c.json(
        { error: `provider "${providerId}" is not available` },
        400,
      );
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ChatEvent) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        };

        try {
          for await (const event of provider.chat({
            prompt,
            sessionId,
            workspace: state.workspace!,
            plugin: state.activePlugin ?? undefined,
            pluginCtx: state.pluginCtx ?? undefined,
            mentions,
            images,
          })) {
            // Persist chat meta on session init
            if (event.kind === "init") {
              void upsertChatMeta(sourceDir, event.sessionId, {
                title: prompt.slice(0, 60),
                mentions,
                provider: providerId,
              });
            }
            send(event);
          }
        } catch (err) {
          send({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
