// add — copy a built-in component into a workspace's components directory.
//
// Usage (via CLI):
//   codoc add Table demo       → copies Table.tsx into ~/.codoc/demo/components/
//   codoc add --all demo       → copies all built-in components
//   codoc add --list           → lists available components

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { catalog, findEntry } from "./catalog.js";

/**
 * Add a component (or all components) to the target directory.
 *
 * @param nameOrFlag  Component name, "--all", or "--list"
 * @param targetDir   Absolute path to the components directory
 */
export async function addComponent(
  nameOrFlag: string,
  targetDir: string,
): Promise<void> {
  if (nameOrFlag === "--list") {
    console.log("Available components:\n");
    for (const entry of catalog) {
      console.log(`  ${entry.name.padEnd(12)} ${entry.description}`);
    }
    return;
  }

  if (nameOrFlag === "--all") {
    await mkdir(targetDir, { recursive: true });
    for (const entry of catalog) {
      await writeOne(entry.name, entry.source, targetDir);
    }
    return;
  }

  const entry = findEntry(nameOrFlag);
  if (!entry) {
    console.error(`Unknown component: "${nameOrFlag}"`);
    console.error(`Available: ${catalog.map((e) => e.name).join(", ")}`);
    process.exit(1);
  }

  await mkdir(targetDir, { recursive: true });
  await writeOne(entry.name, entry.source, targetDir);
}

async function writeOne(
  name: string,
  source: string,
  targetDir: string,
): Promise<void> {
  const filePath = join(targetDir, `${name}.tsx`);

  // Don't overwrite existing files — user may have customized
  try {
    await stat(filePath);
    console.log(`  skip  ${name}.tsx (already exists)`);
    return;
  } catch {
    // File doesn't exist — proceed
  }

  await writeFile(filePath, source, "utf-8");
  console.log(`  added ${name}.tsx`);
}
