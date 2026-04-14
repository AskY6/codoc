// Lightweight client-side frontmatter splitter.
//
// Extracts the YAML frontmatter and MDX body from codoc content.
// Does NOT parse YAML (no dependency) — just splits on `---` delimiters
// and does a minimal key-value extraction for the `data:` block.
// For full parsing, the server-side parser in @cobook/service is
// authoritative; this is a best-effort client-side helper for preview.

export interface ParsedCodoc {
  /** Raw YAML frontmatter string (between --- delimiters). */
  frontmatter: string;
  /** MDX body after the closing ---. */
  body: string;
  /** Best-effort extraction of data fields from frontmatter. */
  data: Record<string, unknown>;
  /** Tags extracted from frontmatter `tags: [...]`. */
  tags: readonly string[];
}

export function parseCodocContent(content: string): ParsedCodoc | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return null;

  const closingIndex = trimmed.indexOf("\n---", firstNewline);
  if (closingIndex === -1) return null;

  const frontmatter = trimmed.slice(firstNewline + 1, closingIndex);
  const afterClosing = closingIndex + 4;
  const nextNewline = trimmed.indexOf("\n", afterClosing);
  const body =
    nextNewline === -1
      ? trimmed.slice(afterClosing).trim()
      : trimmed.slice(nextNewline + 1);

  // Best-effort data extraction: find the `data:` block and parse
  // simple `key: value` pairs. Refs ($ref) and nested objects are
  // skipped — they need server-side resolution.
  const data = extractDataBlock(frontmatter);
  const tags = extractTags(frontmatter);

  return { frontmatter, body: body.trim(), data, tags };
}

function extractDataBlock(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let inData = false;

  for (const line of lines) {
    // Detect `data:` at top level (no indent).
    if (/^data:\s*$/.test(line)) {
      inData = true;
      continue;
    }

    // Any non-indented line exits the data block.
    if (inData && line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      inData = false;
    }

    if (!inData) continue;

    // Parse `  key: value` (2-space indent = direct child of data).
    const match = line.match(/^  (\w+):\s+(.+)$/);
    if (match) {
      const key = match[1]!;
      const rawVal = match[2]!;
      // Skip $ref and $source lines — they need server resolution.
      if (rawVal.startsWith("{") || rawVal.startsWith("[")) continue;
      // Try to parse as number.
      const num = Number(rawVal);
      data[key] = isNaN(num) ? stripQuotes(rawVal) : num;
    }
  }

  return data;
}

/** Extract tags from `tags: [a, b, c]` in frontmatter. */
function extractTags(yaml: string): readonly string[] {
  const match = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
