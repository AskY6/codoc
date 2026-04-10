import {
  parseSession,
  parseSessionSummary,
  projectNameFromDir,
} from "@/lib/claude-code-log/index.js";
import type {
  ProjectInfo,
  SessionSummary,
  ParsedSession,
} from "@/lib/claude-code-log/index.js";
import { getConnector } from "@/lib/local-filesystem.js";
import { registerClientSource } from "@/lib/source-registry.js";
import type { SourceResult } from "@/lib/source-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Join connector-relative path segments, avoiding "./" prefixes that the
 *  daemon guard rejects (segments must not contain "." or ""). */
function joinPath(base: string, ...parts: string[]): string {
  if (base === ".") return parts.join("/");
  return [base, ...parts].join("/");
}

/** The connector rootPath is already `.claude/projects`, so map legacy
 *  absolute-style path hints to the connector-relative root. */
function normalizeBasePath(raw: string | undefined): string {
  if (!raw || raw === ".claude/projects") return ".";
  return raw;
}

// ---------------------------------------------------------------------------
// Resolve modes
// ---------------------------------------------------------------------------

async function resolveProjects(
  params: Record<string, unknown>,
): Promise<SourceResult> {
  const connector = await getConnector();
  const basePath = normalizeBasePath(params["path"] as string | undefined);
  const entries = await connector.filesystem.readDir(basePath);

  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    if (entry.kind !== "directory") continue;

    // Count .jsonl files inside
    let sessionCount = 0;
    try {
      const files = await connector.filesystem.readDir(
        joinPath(basePath, entry.name),
      );
      sessionCount = files.filter(
        (f) => f.kind === "file" && f.name.endsWith(".jsonl"),
      ).length;
    } catch {
      // Directory may be inaccessible
      continue;
    }

    if (sessionCount === 0) continue;

    projects.push({
      id: entry.name,
      name: projectNameFromDir(entry.name),
      path: joinPath(basePath, entry.name),
      sessionCount,
    });
  }

  // Sort by session count descending
  projects.sort((a, b) => b.sessionCount - a.sessionCount);

  return { data: projects };
}

async function resolveSessions(
  params: Record<string, unknown>,
): Promise<SourceResult> {
  const connector = await getConnector();
  const projectPath = String(params["projectPath"]);
  const entries = await connector.filesystem.readDir(projectPath);

  const jsonlFiles = entries.filter(
    (e) => e.kind === "file" && e.name.endsWith(".jsonl"),
  );

  const summaries: SessionSummary[] = [];

  for (const file of jsonlFiles) {
    try {
      const result = await connector.filesystem.readFile(
        joinPath(projectPath, file.name),
      );
      const id = file.name.replace(/\.jsonl$/, "");
      const summary = parseSessionSummary(result.content, id, file.name);
      // Skip sessions with no real messages
      if (summary.messageCount === 0) continue;
      summaries.push(summary);
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by start time descending (most recent first)
  summaries.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  return { data: summaries };
}

async function resolveSession(
  params: Record<string, unknown>,
): Promise<SourceResult> {
  const connector = await getConnector();
  const file = String(params["file"]);
  const result = await connector.filesystem.readFile(file);
  const session: ParsedSession = parseSession(result.content);
  return { data: session };
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export function registerClaudeCodeLogSource(): void {
  registerClientSource({
    name: "local:claude-code-log",
    async resolve(params) {
      const mode = String(params["mode"]);
      switch (mode) {
        case "projects":
          return resolveProjects(params);
        case "sessions":
          return resolveSessions(params);
        case "session":
          return resolveSession(params);
        default:
          throw new Error(`Unknown claude-code-log mode: ${mode}`);
      }
    },
  });
}
