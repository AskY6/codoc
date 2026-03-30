import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { registerWorkspaceLoaders } from "../wiring/bootstrap.js";
import { DocRegistry } from "../lifecycle/instance-store.js";
import { WatchOrchestrator } from "../watch/orchestrator.js";
import { claudeCodeLogSkill } from "../skill/claude-code-log.js";
import { ingestDirectory } from "../skill/ingest.js";

const CLAUDE_PROJECT_DIR =
  process.env.HOME + "/.claude/projects/-Users-kxzhang-code-local-tool-codoc";

describe("Real Claude Code logs", () => {
  let available = false;

  beforeAll(() => {
    registerWorkspaceLoaders();
    available = existsSync(CLAUDE_PROJECT_DIR);
  });

  it("should identify real project directory", async () => {
    if (!available) return;
    const identified = await claudeCodeLogSkill.identify(CLAUDE_PROJECT_DIR);
    expect(identified).toBe(true);
  });

  it("should ingest real session files and observe messages", async () => {
    if (!available) return;

    const registry = new DocRegistry();
    const orchestrator = new WatchOrchestrator(registry);

    const result = await ingestDirectory(
      CLAUDE_PROJECT_DIR,
      claudeCodeLogSkill,
      registry,
      orchestrator,
    );

    console.log(`Ingested ${result.docIds.length} session files`);
    expect(result.docIds.length).toBeGreaterThan(0);

    // Observe the first session
    const firstDocId = result.docIds[0];
    const entry = registry.get(firstDocId)!;
    const messages = await entry.tree.observe<unknown[]>("/messages");

    console.log(`Session ${firstDocId}: ${messages.length} messages`);
    expect(messages.length).toBeGreaterThan(0);

    // Check message structure — all entries have a "type" field
    const first = messages[0] as Record<string, unknown>;
    expect(first).toHaveProperty("type");
    // Common types: user, assistant, system, progress, file-history-snapshot
    expect(["user", "assistant", "system", "progress", "file-history-snapshot"]).toContain(first.type);

    result.dispose();
  });
});
