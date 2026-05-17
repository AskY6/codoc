// providers/kiro — Kiro CLI adapter via ACP (Agent Client Protocol).
//
// Spawns `kiro-cli acp` as a subprocess, communicates via JSON-RPC 2.0 over stdio.
// Streams session/update notifications and maps them to ChatEvent.

import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ChatProvider, ChatParams, ChatEvent, SessionMessage } from "./types.js";
import { readAgentInstructions } from "./types.js";

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

// ---------------------------------------------------------------------------
// ACP client — manages kiro-cli acp subprocess lifecycle
// ---------------------------------------------------------------------------

class AcpClient {
  private child: ReturnType<typeof spawn>;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private notifications: JsonRpcResponse[] = [];
  private notificationListeners: Array<(n: JsonRpcResponse) => void> = [];

  constructor(cwd: string) {
    this.child = spawn("kiro-cli", ["acp"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.child.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.child.stderr!.on("data", (chunk: Buffer) => {
      // Kiro emits progress/debug info on stderr — ignore
      void chunk;
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }

      // Response to a request
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message));
        } else {
          p.resolve(msg.result);
        }
        continue;
      }

      // Notification (no id, has method)
      if (msg.method) {
        for (const listener of this.notificationListeners) {
          listener(msg);
        }
      }
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params != null ? { params } : {}) };
    this.child.stdin!.write(JSON.stringify(msg) + "\n");

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  onNotification(listener: (n: JsonRpcResponse) => void): void {
    this.notificationListeners.push(listener);
  }

  removeNotificationListener(listener: (n: JsonRpcResponse) => void): void {
    this.notificationListeners = this.notificationListeners.filter((l) => l !== listener);
  }

  kill(): void {
    try {
      this.child.kill("SIGTERM");
    } catch {
      // already dead
    }
  }

  onClose(cb: () => void): void {
    this.child.on("close", cb);
  }
}

// ---------------------------------------------------------------------------
// ACP notification → ChatEvent mapping
// ---------------------------------------------------------------------------

function mapAcpNotification(msg: JsonRpcResponse): ChatEvent[] {
  if (msg.method !== "session/update") return [];

  const params = msg.params as Record<string, unknown> | undefined;
  if (!params) return [];

  const update = params.update as Record<string, unknown> | undefined;
  if (!update) return [];

  const sessionUpdate = update.sessionUpdate as string | undefined;

  switch (sessionUpdate) {
    case "agent_message_chunk": {
      const content = update.content as Record<string, unknown> | undefined;
      const text = content?.text as string | undefined;
      if (text) {
        return [{ kind: "text", text }];
      }
      return [];
    }

    case "tool_call": {
      const toolCall = update.toolCall as Record<string, unknown> | undefined;
      const name = (toolCall?.name as string) ?? "unknown";
      const input = (toolCall?.input as Record<string, unknown>) ?? {};
      return [{ kind: "tool_use", name, input }];
    }

    case "tool_call_update": {
      const toolCall = update.toolCall as Record<string, unknown> | undefined;
      const name = (toolCall?.name as string) ?? "unknown";
      return [{ kind: "tool_result", name }];
    }

    case "agent_thought_chunk":
    case "plan":
    case "available_commands_update":
    case "user_message_chunk":
    case "tool_call_chunk":
      // Informational — skip for now
      return [];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Session history reader
// ---------------------------------------------------------------------------

async function readKiroSessionMessages(
  sessionId: string,
  _cwd: string,
): Promise<SessionMessage[]> {
  const sessionFile = join(homedir(), ".kiro", "sessions", "cli", `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf-8");
  } catch {
    return [];
  }

  const messages: SessionMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const kind = entry.kind as string | undefined;
    const data = entry.data as Record<string, unknown> | undefined;
    if (!data) continue;

    const contentBlocks = data.content as Array<{ kind: string; data: string }> | undefined;
    const text = contentBlocks
      ?.filter((b) => b.kind === "text" && b.data)
      .map((b) => b.data)
      .join("\n") ?? "";

    if (kind === "AssistantMessage") {
      const toolUses = data.toolUse as Array<{ name: string }> | undefined;
      const toolCalls = toolUses?.map((t) => ({ name: t.name, status: "done" as const }));
      if (text) {
        const msg: SessionMessage = { role: "assistant", text };
        if (toolCalls && toolCalls.length > 0) msg.toolCalls = toolCalls;
        messages.push(msg);
      }
    } else if (kind === "Prompt" || kind === "UserMessage" || kind === "HumanMessage") {
      if (text) {
        messages.push({ role: "user", text });
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const kiroProvider: ChatProvider = {
  id: "kiro",
  name: "Kiro",

  async detect(): Promise<boolean> {
    return new Promise((res) => {
      execFile("kiro-cli", ["--version"], (err) => res(!err));
    });
  },

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const { prompt, sessionId, workspace, pluginInstructions, signal } = params;

    const client = new AcpClient(workspace.sourceDir);

    if (signal) {
      signal.addEventListener("abort", () => client.kill(), { once: true });
    }

    try {
      // Step 1: Initialize
      await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "codoc", version: "1.0.0" },
      });

      // Step 2: Create or load session
      let acpSessionId: string;

      if (sessionId) {
        const result = await client.request("session/load", { sessionId }) as Record<string, unknown>;
        acpSessionId = (result.sessionId as string) ?? sessionId;
      } else {
        const result = await client.request("session/new", {
          cwd: workspace.sourceDir,
          mcpServers: [],
        }) as Record<string, unknown>;
        acpSessionId = result.sessionId as string;
      }

      yield { kind: "init", sessionId: acpSessionId };

      // Step 3: Set up notification listener and send prompt
      const events: ChatEvent[] = [];
      let streamDone = false;

      const notificationHandler = (n: JsonRpcResponse) => {
        const mapped = mapAcpNotification(n);
        events.push(...mapped);
      };

      client.onNotification(notificationHandler);

      // Prepend agent instructions as context if configured
      const extra = readAgentInstructions(workspace, pluginInstructions);
      const fullPrompt = extra ? `[System context]\n${extra}\n\n[User request]\n${prompt}` : prompt;

      // Send the prompt (fire-and-forget — response comes via notifications)
      const promptResult = client.request("session/prompt", {
        sessionId: acpSessionId,
        prompt: [{ type: "text", text: fullPrompt }],
      });

      // Yield events as they arrive
      const pollInterval = 50; // ms
      while (!streamDone) {
        await new Promise((r) => setTimeout(r, pollInterval));

        while (events.length > 0) {
          yield events.shift()!;
        }

        // Check if prompt request has completed
        const settled = await Promise.race([
          promptResult.then(() => true),
          new Promise<false>((r) => setTimeout(() => r(false), 0)),
        ]);

        if (settled) {
          // Drain remaining events
          await new Promise((r) => setTimeout(r, 100));
          while (events.length > 0) {
            yield events.shift()!;
          }
          streamDone = true;
        }
      }

      client.removeNotificationListener(notificationHandler);
      yield { kind: "done" };
    } catch (err) {
      yield {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      client.kill();
    }
  },

  readHistory: readKiroSessionMessages,
};
