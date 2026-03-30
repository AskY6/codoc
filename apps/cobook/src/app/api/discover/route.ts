import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ProjectEntry {
  /** Directory name, e.g. "-Users-kxzhang-code-local-tool-codoc" */
  name: string;
  /** Full path to the project directory */
  path: string;
}

/**
 * GET /api/discover
 * Scans ~/.claude/projects/ and returns available Claude Code project directories.
 */
export async function GET() {
  const projectsRoot = join(homedir(), ".claude", "projects");

  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    const projects: ProjectEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(projectsRoot, entry.name);
      // Check if directory contains .jsonl files
      const files = await readdir(dirPath).catch(() => []);
      const hasJsonl = files.some((f) => f.endsWith(".jsonl"));
      if (hasJsonl) {
        projects.push({ name: entry.name, path: dirPath });
      }
    }

    return NextResponse.json(projects);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
