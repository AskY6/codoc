import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerWorkspaceLoaders } from "../wiring/bootstrap.js";
import { DocRegistry } from "../lifecycle/instance-store.js";
import { WatchOrchestrator } from "../watch/orchestrator.js";
import { claudeCodeLogSkill } from "../skill/claude-code-log.js";
import { ingestDirectory } from "../skill/ingest.js";

// Sample JSONL entries mimicking Claude Code session format
const sampleEntries = [
  { type: "user", uuid: "u1", timestamp: "2026-03-30T10:00:00Z", sessionId: "aaa", message: { role: "user", content: "Hello" } },
  { type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-03-30T10:00:01Z", sessionId: "aaa", message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] } },
  { type: "user", uuid: "u2", parentUuid: "a1", timestamp: "2026-03-30T10:00:10Z", sessionId: "aaa", message: { role: "user", content: "Fix the bug" } },
];

function toJsonl(entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("Claude Code Log — full flow", () => {
  let tmpDir: string;

  beforeAll(async () => {
    registerWorkspaceLoaders();
    tmpDir = await mkdtemp(join(tmpdir(), "codoc-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("Phase 1: skill identifies Claude Code log directory", async () => {
    // Write a JSONL file into the temp directory
    await writeFile(join(tmpDir, "aaa.jsonl"), toJsonl(sampleEntries));

    const identified = await claudeCodeLogSkill.identify(tmpDir);
    expect(identified).toBe(true);
  });

  it("Phase 1: mapToCodoc produces valid codoc definition", () => {
    const codoc = claudeCodeLogSkill.mapToCodoc(
      join(tmpDir, "aaa.jsonl"),
      "aaa.jsonl",
    );

    expect(codoc.meta.data).toBeDefined();
    expect(codoc.meta.data.properties).toHaveProperty("messages");
    expect(codoc.data).toHaveProperty("messages");
    expect(codoc.view).toContain("Session");

    const source = (codoc.data.messages as Record<string, unknown>).$source as Record<string, unknown>;
    expect(source.connector).toBe("local-file");
    expect(source.parser).toBe("jsonl");
  });

  it("Phase 1+2: ingest directory creates codocs that can be observed", async () => {
    // Write two session files
    await writeFile(
      join(tmpDir, "bbb.jsonl"),
      toJsonl([
        { type: "user", uuid: "b1", timestamp: "2026-03-30T11:00:00Z", sessionId: "bbb", message: { role: "user", content: "Another session" } },
      ]),
    );

    const registry = new DocRegistry();
    const orchestrator = new WatchOrchestrator(registry);

    const result = await ingestDirectory(
      tmpDir,
      claudeCodeLogSkill,
      registry,
      orchestrator,
    );

    expect(result.docIds.length).toBe(2);
    expect(result.docIds).toContain("session-aaa.codoc");
    expect(result.docIds).toContain("session-bbb.codoc");

    // Phase 2: Observe a session — triggers force, reads file, parses JSONL
    const entry = registry.get("session-aaa.codoc");
    expect(entry).toBeDefined();

    const messages = await entry!.tree.observe<unknown[]>("/messages");
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(3);
    expect((messages[0] as Record<string, unknown>).type).toBe("user");
    expect((messages[1] as Record<string, unknown>).type).toBe("assistant");

    result.dispose();
  });

  it("Phase 3: file watcher detects content changes", async () => {
    const registry = new DocRegistry();
    const orchestrator = new WatchOrchestrator(registry);

    // Create a single-file directory
    const watchDir = await mkdtemp(join(tmpdir(), "codoc-watch-"));
    await writeFile(
      join(watchDir, "ccc.jsonl"),
      toJsonl([{ type: "user", uuid: "c1", timestamp: "2026-03-30T12:00:00Z", sessionId: "ccc", message: { role: "user", content: "Start" } }]),
    );

    const result = await ingestDirectory(
      watchDir,
      claudeCodeLogSkill,
      registry,
      orchestrator,
    );

    // Initial observe
    const entry = registry.get("session-ccc.codoc")!;
    const initial = await entry.tree.observe<unknown[]>("/messages");
    expect(initial.length).toBe(1);

    // Track source_changed events
    const events: string[] = [];
    orchestrator.onEvent((event) => {
      events.push(`${event.kind}:${event.docId}`);
    });

    // Append a new message to the file
    await appendFile(
      join(watchDir, "ccc.jsonl"),
      JSON.stringify({ type: "assistant", uuid: "c2", parentUuid: "c1", timestamp: "2026-03-30T12:00:01Z", sessionId: "ccc", message: { role: "assistant", content: [{ type: "text", text: "Response" }] } }) + "\n",
    );

    // Wait for debounced watcher to fire (300ms debounce + margin)
    await new Promise((r) => setTimeout(r, 600));

    // After watcher fires, the field should be re-forced with the new data
    const updated = await entry.tree.observe<unknown[]>("/messages");
    expect(updated.length).toBe(2);

    result.dispose();
    await rm(watchDir, { recursive: true, force: true });
  });
});
