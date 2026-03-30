import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerWorkspaceLoaders } from "../wiring/bootstrap.js";
import { Workspace } from "../api/workspace-api.js";
import { claudeCodeLogSkill } from "../skill/claude-code-log.js";

function toJsonl(entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("Workspace.ingestSkillDirectory", () => {
  let tmpDir: string;
  let docsDir: string;
  let logsDir: string;

  beforeAll(async () => {
    registerWorkspaceLoaders();
    tmpDir = await mkdtemp(join(tmpdir(), "codoc-ws-ingest-"));
    docsDir = join(tmpDir, "docs");
    logsDir = join(tmpDir, "logs");
    await mkdir(docsDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });

    // Create some session files
    await writeFile(
      join(logsDir, "session-1.jsonl"),
      toJsonl([
        { type: "user", uuid: "u1", timestamp: "2026-03-30T10:00:00Z", sessionId: "s1", message: { role: "user", content: "Hello" } },
        { type: "assistant", uuid: "a1", timestamp: "2026-03-30T10:00:01Z", sessionId: "s1", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
      ]),
    );
    await writeFile(
      join(logsDir, "session-2.jsonl"),
      toJsonl([
        { type: "user", uuid: "u2", timestamp: "2026-03-30T11:00:00Z", sessionId: "s2", message: { role: "user", content: "Bye" } },
      ]),
    );
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ingests external directory and makes docs available via workspace API", async () => {
    const ws = await Workspace.create(docsDir);

    // Before ingestion, no docs
    expect(ws.listDocs()).toHaveLength(0);

    // Ingest the Claude Code logs directory
    const docIds = await ws.ingestSkillDirectory(logsDir, claudeCodeLogSkill);

    expect(docIds).toHaveLength(2);

    // Now the workspace lists the ingested docs
    const docs = ws.listDocs();
    expect(docs).toHaveLength(2);

    // Can load and observe a doc
    const runtime = ws.loadDoc(docIds[0]);
    const messages = await runtime.tree.observe<unknown[]>("/messages");
    expect(messages.length).toBeGreaterThan(0);

    // Change listener works
    const changes: string[] = [];
    ws.onFieldChange((event) => {
      changes.push(`${event.docId}:${event.fieldPath}`);
    });
  });
});
