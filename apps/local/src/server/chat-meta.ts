// chat-meta — lightweight chat metadata persisted as <sourceDir>/chats.json.
//
// Each entry stores just enough to list past conversations and resume them
// via the provider's session ID. Full conversation history lives in
// each CLI's native storage — we never duplicate it.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChatMeta {
  sessionId: string;
  provider: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  mentions: string[];
}

const FILENAME = "chats.json";

function filePath(sourceDir: string): string {
  return join(sourceDir, FILENAME);
}

export async function loadChatMetas(sourceDir: string): Promise<ChatMeta[]> {
  try {
    const raw = await readFile(filePath(sourceDir), "utf-8");
    return JSON.parse(raw) as ChatMeta[];
  } catch {
    return [];
  }
}

export async function upsertChatMeta(
  sourceDir: string,
  sessionId: string,
  patch: { title?: string; mentions?: string[]; provider?: string },
): Promise<void> {
  const metas = await loadChatMetas(sourceDir);
  const now = new Date().toISOString();
  const idx = metas.findIndex((m) => m.sessionId === sessionId);
  if (idx >= 0) {
    metas[idx]!.lastActiveAt = now;
  } else {
    metas.push({
      sessionId,
      provider: patch.provider ?? "claude-code",
      title: patch.title ?? "Untitled",
      createdAt: now,
      lastActiveAt: now,
      mentions: patch.mentions ?? [],
    });
  }
  await writeFile(filePath(sourceDir), JSON.stringify(metas, null, 2) + "\n", "utf-8");
}

export async function deleteChatMeta(
  sourceDir: string,
  sessionId: string,
): Promise<boolean> {
  const metas = await loadChatMetas(sourceDir);
  const filtered = metas.filter((m) => m.sessionId !== sessionId);
  if (filtered.length === metas.length) return false;
  await writeFile(filePath(sourceDir), JSON.stringify(filtered, null, 2) + "\n", "utf-8");
  return true;
}

// Session history reading is now handled by each provider adapter.
// See providers/claude-code.ts, providers/codex.ts, providers/kiro.ts.
