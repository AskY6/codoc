// Domain types — the in-memory shape of a workspace and its codocs.
// Pure declarations plus the one purely derived helper (buildAstMap).
//
// Loading from disk, compiling to .mdx, and any other IO lives in `../runtime/`.

import type { CodocAST, CodocPath, ResolveResult } from "@cobook/core";
import type { SourceRegistry } from "@cobook/parser";
import type { Diagnostic } from "./diagnose.js";
import type { CustomComponentEntry } from "./components.js";

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

export type WriteResult =
  | { ok: true; diagnostics: readonly Diagnostic[] }
  | { ok: false; diagnostics: readonly Diagnostic[] };

/** Build the AST lookup map from current workspace state. */
export function buildAstMap(ws: Workspace): ReadonlyMap<CodocPath, CodocAST> {
  const m = new Map<CodocPath, CodocAST>();
  for (const [path, codoc] of ws.codocs) {
    m.set(path, codoc.ast);
  }
  return m;
}
