// workspace — manages the local codoc workspace state.
//
// Reads .codoc files from a source directory, parses them, maintains
// an in-memory AST map for ref resolution and DAG validation.

import { readFile, readdir, writeFile, mkdir, unlink } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import type { CodocAST, CodocPath, ResolveResult } from "@cobook/core";
import { CodocPath as mkCodocPath } from "@cobook/core";
import { parseCodoc } from "@cobook/parser";
import type { SourceRegistry } from "@cobook/parser";
import { compileCodoc } from "@cobook/compiler";
import { resolveDataFields, toAstMap, validateDAG } from "./resolve.js";
import type { CustomComponentEntry } from "./components.js";
import { scanComponents } from "./components.js";

export interface LocalCodoc {
  readonly path: CodocPath;
  readonly content: string;
  readonly ast: CodocAST;
  readonly resolvedData: Record<string, ResolveResult> | null;
}

export interface Workspace {
  /** Source directory containing .codoc files */
  readonly sourceDir: string;
  /** Output directory for compiled .mdx files */
  readonly outDir: string;
  /** In-memory codoc map (path → parsed) */
  readonly codocs: Map<CodocPath, LocalCodoc>;
  /** Source providers for $source fields */
  readonly sourceProviders: SourceRegistry;
  /** Custom components loaded from .codoc/components/*.tsx */
  customComponents: CustomComponentEntry[];
}

/** Initialize workspace from a directory. */
export async function loadWorkspace(
  sourceDir: string,
  outDir: string,
  sourceProviders: SourceRegistry,
): Promise<Workspace> {
  const ws: Workspace = {
    sourceDir,
    outDir,
    codocs: new Map(),
    sourceProviders,
    customComponents: [],
  };

  const files = await findCodocFiles(sourceDir);
  for (const filePath of files) {
    await loadFile(ws, filePath);
  }

  // Resolve all after initial load
  await resolveAll(ws);

  // Load custom components
  await loadComponents(ws);

  return ws;
}

/** Load or reload a single .codoc file into the workspace. */
export async function loadFile(ws: Workspace, absolutePath: string): Promise<void> {
  const rel = relative(ws.sourceDir, absolutePath);
  const codocPath = mkCodocPath(rel);
  const content = await readFile(absolutePath, "utf-8");

  const result = parseCodoc(content);
  if (!result.ok) {
    console.warn(`[codoc] parse error in ${rel}: ${result.error.kind}`);
    return;
  }

  ws.codocs.set(codocPath, {
    path: codocPath,
    content,
    ast: result.value,
    resolvedData: null,
  });
}

/** Remove a codoc from the workspace (file was deleted). Also cleans up the compiled .mdx output. */
export async function removeFile(ws: Workspace, absolutePath: string): Promise<void> {
  const rel = relative(ws.sourceDir, absolutePath);
  const codocPath = mkCodocPath(rel);
  ws.codocs.delete(codocPath);

  // Clean up compiled output
  const outPath = join(ws.outDir, codocPath.replace(/\.codoc$/, ".mdx"));
  await unlink(outPath).catch(() => {});
}

/** Re-resolve all data fields across the workspace. */
export async function resolveAll(ws: Workspace): Promise<void> {
  const astMap = buildAstMap(ws);

  // Validate DAG (advisory warnings)
  validateDAG(astMap);

  // Resolve each codoc's data fields
  for (const [path, codoc] of ws.codocs) {
    const resolved = await resolveDataFields(
      { path, ast: codoc.ast },
      astMap,
      ws.sourceProviders,
    );
    // Update in place (Map is mutable within workspace)
    ws.codocs.set(path, { ...codoc, resolvedData: resolved });
  }
}

/** Compile all codocs and write .mdx output files. */
export async function compileAll(ws: Workspace): Promise<void> {
  for (const codoc of ws.codocs.values()) {
    await compileOne(ws, codoc);
  }
}

/** Compile a single codoc to .mdx and write to outDir. */
export async function compileOne(ws: Workspace, codoc: LocalCodoc): Promise<void> {
  const mdx = compileCodoc({
    ast: codoc.ast,
    resolvedData: codoc.resolvedData,
  });

  const outPath = join(ws.outDir, codoc.path.replace(/\.codoc$/, ".mdx"));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, mdx, "utf-8");
}

/** Write a codoc source file and reload it. */
export async function writeCodoc(
  ws: Workspace,
  codocPath: CodocPath,
  content: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Validate parse before writing
  const result = parseCodoc(content);
  if (!result.ok) {
    return { ok: false, error: `Parse error: ${result.error.kind}` };
  }

  const absolutePath = join(ws.sourceDir, codocPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");

  // Reload into workspace
  await loadFile(ws, absolutePath);
  await resolveAll(ws);
  await compileAll(ws);

  return { ok: true };
}

/** Build the AST lookup map from current workspace state. */
export function buildAstMap(ws: Workspace): ReadonlyMap<CodocPath, CodocAST> {
  const m = new Map<CodocPath, CodocAST>();
  for (const [path, codoc] of ws.codocs) {
    m.set(path, codoc.ast);
  }
  return m;
}

/** Scan and compile custom components from .codoc/components/. */
export async function loadComponents(ws: Workspace): Promise<void> {
  const componentsDir = join(ws.sourceDir, "components");
  ws.customComponents = await scanComponents(componentsDir);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findCodocFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".codoc")) {
      // parentPath available in Node 20.12+; fallback to (entry as any).path
      const parent: string =
        (entry as unknown as { parentPath?: string }).parentPath ??
        (entry as unknown as { path: string }).path;
      results.push(join(parent, entry.name));
    }
  }
  return results;
}
