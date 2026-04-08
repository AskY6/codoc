import type { Ref } from "./ref-types.js";

/**
 * Resolve a relative ref against a base codoc path,
 * producing a fully-qualified NodeId string.
 *
 * Example:
 *   normalizeRef({ path: "./other.codoc", field: "data.x" }, "notes/meeting.codoc")
 *   → "notes/other.codoc#data.x"
 */
export function normalizeRef(ref: Ref, baseCodocPath: string): string {
  // Paths starting with "./" or "../" are relative to the base codoc's directory.
  // All other paths are absolute (workspace-root-relative).
  if (ref.path.startsWith("./") || ref.path.startsWith("../")) {
    const baseDir = dirname(baseCodocPath);
    const resolved = resolvePath(baseDir, ref.path);
    return `${resolved}#${ref.field}`;
  }
  return `${ref.path}#${ref.field}`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function resolvePath(baseDir: string, relative: string): string {
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of relative.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}
