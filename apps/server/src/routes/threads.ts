// /api/threads — thread-scoped actions that don't fit under the
// workspace path. Listing + creating threads live on
// /api/workspaces/:id/threads (see ./workspaces.ts); this router owns
// the detail page bundle, delete, and user-message append.
//
// The router is parameterised over a base `ServiceCtx` so the
// composition root in `index.ts` is the only place that picks a
// concrete `Storage` impl.

import type { AgentId, CodocId, ThreadId } from "@cobook/core";
import type { ServiceCtx } from "@cobook/service";
import {
  appendUserMessage,
  deleteThread,
  getThread,
  runAgentTurn,
  setThreadAgents,
  setThreadCodocs,
} from "@cobook/service";
import { Hono } from "hono";
import { respondError } from "../http/error.js";

interface AppendMessageBody {
  readonly content?: unknown;
}

interface SetThreadAgentsBody {
  readonly agentIds?: unknown;
}

interface SetThreadCodocsBody {
  readonly codocIds?: unknown;
}

interface RunAgentTurnBody {
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
  // Direct user-message append (no agent turn). The primary send path
  // is POST /:id/turn which runs the agent graph; this endpoint
  // remains for appending user messages without triggering agents.
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

  // PUT /api/threads/:id/agents — { agentIds: string[] }
  app.put("/:id/agents", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: SetThreadAgentsBody;
    try {
      body = (await c.req.json()) as SetThreadAgentsBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (
      !Array.isArray(body.agentIds) ||
      !body.agentIds.every((v: unknown) => typeof v === "string")
    ) {
      return c.json(
        { error: { kind: "bad-request", reason: "agentIds must be an array of strings" } },
        400,
      );
    }

    const result = await setThreadAgents(baseCtx, {
      threadId,
      agentIds: body.agentIds as AgentId[],
    });

    if (!result.ok) {
      const e = result.error;
      if (e.kind === "tx-aborted") {
        return c.json({ error: { kind: "storage-unavailable" } }, 503);
      }
      return respondError(c, e);
    }
    return c.json({ agentIds: result.value });
  });

  // PUT /api/threads/:id/codocs — { codocIds: string[] }
  app.put("/:id/codocs", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: SetThreadCodocsBody;
    try {
      body = (await c.req.json()) as SetThreadCodocsBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (
      !Array.isArray(body.codocIds) ||
      !body.codocIds.every((v: unknown) => typeof v === "string")
    ) {
      return c.json(
        {
          error: { kind: "bad-request", reason: "codocIds must be an array of strings" },
        },
        400,
      );
    }

    const result = await setThreadCodocs(baseCtx, {
      threadId,
      codocIds: body.codocIds as CodocId[],
    });

    if (!result.ok) {
      const e = result.error;
      if (e.kind === "tx-aborted") {
        return c.json({ error: { kind: "storage-unavailable" } }, 503);
      }
      return respondError(c, e);
    }
    return c.json({ codocIds: result.value });
  });

  // POST /api/threads/:id/turn — { content }
  //
  // Synchronous agent turn (5a). Runs the router → specialist graph
  // and returns the user message + assistant messages as JSON.
  // Slice 5b will upgrade this to SSE streaming.
  app.post("/:id/turn", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: RunAgentTurnBody;
    try {
      body = (await c.req.json()) as RunAgentTurnBody;
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

    const result = await runAgentTurn(baseCtx, {
      threadId,
      content: body.content,
    });

    if (!result.ok) {
      const e = result.error;
      if (e.kind === "thread-not-found") {
        return respondError(c, e);
      }
      // graph-build-failed / graph-run-failed — internal server error
      return c.json({ error: { kind: e.kind, message: e.message } }, 500);
    }

    return c.json({
      userMessage: result.value.userMessage,
      assistantMessages: result.value.assistantMessages,
    });
  });

  return app;
}
