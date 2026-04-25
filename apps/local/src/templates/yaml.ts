// Minimal YAML serializer — no runtime dependency.
// Only handles the subset needed for codoc frontmatter.

export function serializeYaml(obj: unknown, indent: number): string {
  if (obj === null || obj === undefined) return "null\n";
  if (typeof obj === "string") return quoteIfNeeded(obj) + "\n";
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj) + "\n";

  const pad = "  ".repeat(indent);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]\n";
    let out = "";
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // Inline first key on the `- ` line, rest indented
        const entries = Object.entries(item);
        for (let i = 0; i < entries.length; i++) {
          const [k, v] = entries[i]!;
          if (i === 0) {
            out += `${pad}- ${k}: ${formatValue(v, indent + 1)}`;
          } else {
            out += `${pad}  ${k}: ${formatValue(v, indent + 1)}`;
          }
        }
      } else {
        out += `${pad}- ${serializeYaml(item, indent + 1)}`;
      }
    }
    return out;
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}\n";
    let out = "";
    for (const [k, v] of entries) {
      out += `${pad}${k}: ${formatValue(v, indent + 1)}`;
    }
    return out;
  }

  return String(obj) + "\n";
}

/** Format a value that appears after `key: `.
 *  Objects and arrays go on the next line; scalars stay inline.
 *  Empty arrays/objects stay inline. */
function formatValue(v: unknown, indent: number): string {
  if (v === null || v === undefined) return "null\n";
  if (typeof v === "string") return quoteIfNeeded(v) + "\n";
  if (typeof v === "number" || typeof v === "boolean") return String(v) + "\n";
  // Empty array/object stays inline
  if (Array.isArray(v) && v.length === 0) return "[]\n";
  if (typeof v === "object" && Object.keys(v as object).length === 0) return "{}\n";
  // Non-empty objects and arrays: newline then indented block
  return "\n" + serializeYaml(v, indent);
}

function quoteIfNeeded(s: string): string {
  if (
    s === "" ||
    s.includes(":") ||
    s.includes("#") ||
    s.includes("\n") ||
    s.includes('"') ||
    s.includes("'") ||
    s.startsWith(" ") ||
    s.startsWith("[") ||
    s.startsWith("{") ||
    s.startsWith("-") ||
    /^(true|false|null|yes|no|on|off|\d[\d.]*$)/.test(s)
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}
