// components — scans and transpiles custom .tsx components from .codoc/components/.
//
// Each .tsx file is compiled to CJS via esbuild with React externalized.
// The client evaluates the CJS using a mock require() that resolves react
// from the already-loaded app modules.

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import * as esbuild from "esbuild";
import type { CustomComponentEntry } from "../domain/components.js";

/**
 * Scan `.codoc/components/` for `.tsx` files and compile each to CJS.
 * Returns one entry per file — either compiled output or an error.
 */
export async function scanComponents(
  componentsDir: string,
): Promise<CustomComponentEntry[]> {
  let entries;
  try {
    entries = await readdir(componentsDir, { withFileTypes: true });
  } catch {
    return []; // directory doesn't exist yet — not an error
  }

  const tsxFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".tsx"),
  );

  const results: CustomComponentEntry[] = [];
  for (const file of tsxFiles) {
    const filePath = join(componentsDir, file.name);
    const name = basename(file.name, ".tsx");
    results.push(await compileComponent(filePath, name, componentsDir));
  }

  return results;
}

async function compileComponent(
  filePath: string,
  name: string,
  resolveDir: string,
): Promise<CustomComponentEntry> {
  let source: string;
  try {
    source = await readFile(filePath, "utf-8");
  } catch (e) {
    return {
      kind: "error",
      error: { name, error: `Failed to read: ${e instanceof Error ? e.message : String(e)}` },
    };
  }

  try {
    const result = await esbuild.build({
      stdin: { contents: source, loader: "tsx", resolveDir },
      bundle: true,
      write: false,
      format: "cjs",
      platform: "neutral",
      jsx: "automatic",
      jsxImportSource: "react",
      external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
      logLevel: "silent",
    });

    return {
      kind: "ok",
      component: { name, code: result.outputFiles?.[0]?.text ?? "" },
    };
  } catch (e) {
    return {
      kind: "error",
      error: {
        name,
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
