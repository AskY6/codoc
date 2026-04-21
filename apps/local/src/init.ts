// codoc init — scaffold a new knowledge base.
//
// Creates:
//   .codoc/           (vault directory)
//   codoc.config.json (configuration)
//
// Idempotent: skips existing files/directories without overwriting.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_CONFIG = {
  port: 4321,
};

export async function initWorkspace(workspaceDir: string): Promise<void> {
  const codocDir = join(workspaceDir, ".codoc");
  const configPath = join(workspaceDir, "codoc.config.json");

  // Create .codoc/ directory
  const dirCreated = await mkdirIfMissing(codocDir);
  if (dirCreated) {
    console.log("[codoc] created .codoc/");
  } else {
    console.log("[codoc] .codoc/ already exists");
  }

  // Create codoc.config.json
  const configCreated = await writeIfMissing(
    configPath,
    JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
  );
  if (configCreated) {
    console.log("[codoc] created codoc.config.json");
  } else {
    console.log("[codoc] codoc.config.json already exists");
  }

  console.log("[codoc] workspace initialized at", workspaceDir);
}

async function mkdirIfMissing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    await mkdir(path, { recursive: true });
    return true;
  }
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    await writeFile(path, content, "utf-8");
    return true;
  }
}
