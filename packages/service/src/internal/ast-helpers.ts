import { parseCodoc, type CodocAST } from "@cobook/core";

// ---------------------------------------------------------------------------
// Content-as-truth: every read re-parses from `content`, and parse errors
// degrade gracefully so corrupted rows don't crash the read path.
// ---------------------------------------------------------------------------

export function parseCodocAstSafe(content: string): CodocAST | null {
  try {
    return parseCodoc(content);
  } catch {
    return null;
  }
}

export function parseCodocMetaSafe(
  content: string,
): CodocAST["meta"] | undefined {
  return parseCodocAstSafe(content)?.meta;
}
