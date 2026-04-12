// /api/threads — thread-scoped actions that don't fit under the
// workspace path. Listing + creating threads live on
// /api/workspaces/:id/threads (see ./workspaces.ts); this router owns
// the detail page bundle, delete, and user-message append.
//
// The router is parameterised over a base `ServiceCtx` so the
// composition root in `index.ts` is the only place that picks a
// concrete `Storage` impl.

import type { ThreadId } from "@cobook/core";
import type { ServiceCtx } from "@cobook/service";
import {
  appendUserMessage,
  deleteThread,
  getThread,
} from "@cobook/service";
import { Hono } from "hono";
import { respondError } from "../http/error.js";

interface AppendMessageBody {
  readonly content?: unknown;
}

export function threadRoutes(baseCtx: ServiceCtx) {
  const app = new Hono();

  // GET /api/threads/:id — page bundle: { thread, messages }
  app.get("/:id", async (c) => {
    const id = c.req.param("id") as ThreadId;
    const result = await getThread(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // DELETE /api/threads/:id
  app.delete("/:id", async (c) => {
    const id = c.req.param("id") as ThreadId;
    const result = await deleteThread(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.body(null, 204);
  });

  // POST /api/threads/:id/messages — { content }
  //
  // Slice 4 is user-only: no agent runtime yet, so the body carries
  // just `content`. Slice 5 will add a sibling run-agent-turn route
  // that produces assistant messages.
  app.post("/:id/messages", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: AppendMessageBody;
    try {
      body = (await c.req.json()) as AppendMessageBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.content !== "string" || body.content.trim() === "") {
      return c.json(
        { error: { kind: "bad-request", reason: "content is required" } },
        400,
      );
    }

    const result = await appendUserMessage(baseCtx, {
      threadId,
      content: body.content,
    });
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value, 201);
  });

  return app;
}
