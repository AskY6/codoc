// patch — shared utility for patching a single data field in codoc frontmatter.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type PatchResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Patch a single data field in a codoc's YAML frontmatter without touching
 * the MDX body. Returns the full updated source string.
 */
export function patchDataField(
  source: string,
  field: string,
  value: unknown,
): PatchResult {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("---")) {
    return { ok: false, error: "codoc has no frontmatter — cannot patch data field" };
  }

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return { ok: false, error: "malformed frontmatter" };
  }

  const closingIndex = trimmed.indexOf("\n---", firstNewline);
  if (closingIndex === -1) {
    return { ok: false, error: "unterminated frontmatter" };
  }

  const yamlStr = trimmed.slice(firstNewline + 1, closingIndex);
  const afterClosing = closingIndex + 4; // \n---
  const rest = trimmed.slice(afterClosing);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlStr);
  } catch (e) {
    return { ok: false, error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "frontmatter is not a mapping" };
  }

  const obj = { ...(parsed as Record<string, unknown>) };
  const data = (
    obj.data != null && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? { ...(obj.data as Record<string, unknown>) }
      : {}
  );

  data[field] = value;
  obj.data = data;

  const newYaml = stringifyYaml(obj, { lineWidth: 0 }).trim();
  return { ok: true, value: `---\n${newYaml}\n---${rest}` };
}

/**
 * Patch a single param within a $source data field in codoc frontmatter.
 * Preserves the $source structure and all other params.
 *
 * Example: patchSourceFieldParam(src, "articles", "interval", 60)
 * changes `articles: { $source: rss, url: "...", interval: 30 }`
 * to      `articles: { $source: rss, url: "...", interval: 60 }`
 */
export function patchSourceFieldParam(
  source: string,
  field: string,
  param: string,
  value: unknown,
): PatchResult {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("---")) {
    return { ok: false, error: "codoc has no frontmatter — cannot patch source param" };
  }

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return { ok: false, error: "malformed frontmatter" };
  }

  const closingIndex = trimmed.indexOf("\n---", firstNewline);
  if (closingIndex === -1) {
    return { ok: false, error: "unterminated frontmatter" };
  }

  const yamlStr = trimmed.slice(firstNewline + 1, closingIndex);
  const afterClosing = closingIndex + 4;
  const rest = trimmed.slice(afterClosing);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlStr);
  } catch (e) {
    return { ok: false, error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "frontmatter is not a mapping" };
  }

  const obj = { ...(parsed as Record<string, unknown>) };
  const data = (
    obj.data != null && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? { ...(obj.data as Record<string, unknown>) }
      : {}
  );

  const fieldVal = data[field];
  if (fieldVal == null || typeof fieldVal !== "object" || Array.isArray(fieldVal)) {
    return { ok: false, error: `"${field}" is not a mapping in data` };
  }

  const fieldObj = fieldVal as Record<string, unknown>;
  if (!("$source" in fieldObj)) {
    return { ok: false, error: `"${field}" is not a $source field` };
  }

  data[field] = { ...fieldObj, [param]: value };
  obj.data = data;

  const newYaml = stringifyYaml(obj, { lineWidth: 0 }).trim();
  return { ok: true, value: `---\n${newYaml}\n---${rest}` };
}
