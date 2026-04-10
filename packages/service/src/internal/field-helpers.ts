import type { ResolvedField } from "@cobook/storage";

// ---------------------------------------------------------------------------
// Per-field state helpers
//
// `codoc_resolved_fields` is the source of truth for a codoc's state: the
// service layer derives a codoc-level aggregate for the UI by scanning its
// rows. Parse errors are recorded as a synthetic field with a reserved
// `#$parse` suffix so the derivation logic has something to aggregate.
// ---------------------------------------------------------------------------

const PARSE_ERROR_SUFFIX = "#$parse";

export function parseErrorNodeId(path: string): string {
  return `${path}${PARSE_ERROR_SUFFIX}`;
}

export function isSyntheticFieldNodeId(nodeId: string): boolean {
  return nodeId.endsWith(PARSE_ERROR_SUFFIX);
}

export function deriveCodocState(fields: ResolvedField[]): string {
  for (const f of fields) {
    if (f.state === "error") return "error";
  }
  return "ready";
}

export function groupFieldsByCodoc(
  fields: ResolvedField[],
): Map<string, ResolvedField[]> {
  const byCodoc = new Map<string, ResolvedField[]>();
  for (const f of fields) {
    let bucket = byCodoc.get(f.codocId);
    if (!bucket) {
      bucket = [];
      byCodoc.set(f.codocId, bucket);
    }
    bucket.push(f);
  }
  return byCodoc;
}

/**
 * Collapse a codoc's resolved field rows into a flat `{ nodeId: value }` map
 * matching the old `resolvedValue` contract. Synthetic parse-error rows are
 * skipped — they exist only to drive state aggregation.
 */
export function fieldsToResolvedData(
  fields: ResolvedField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (isSyntheticFieldNodeId(f.nodeId)) continue;
    out[f.nodeId] = f.value;
  }
  return out;
}
