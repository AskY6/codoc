import type { GraphData } from "@/types.js";

/** Normalize resolvedData from full nodeId keys to simple field names,
 *  and unwrap {kind:"static", value:...} wrappers */
export function normalizeResolvedData(
  resolvedData: Record<string, unknown> | null,
  codocPath: string,
): Record<string, unknown> | null {
  if (!resolvedData) return null;
  const result: Record<string, unknown> = {};
  const prefix = `${codocPath}#data.`;
  for (const [key, raw] of Object.entries(resolvedData)) {
    const fieldName = key.startsWith(prefix)
      ? key.slice(prefix.length)
      : key.replace(/^.*#data\./, "");
    let val = raw;
    while (val && typeof val === "object" && "kind" in val && "value" in val) {
      val = (val as { value: unknown }).value;
    }
    result[fieldName] = val;
  }
  return result;
}

export function findUpstream(graph: GraphData, path: string): string[] {
  return graph.edges
    .filter((e) => e.from.startsWith(path))
    .map((e) => e.to.split("#")[0]!)
    .filter((v, i, a) => a.indexOf(v) === i);
}

export function findDownstream(graph: GraphData, path: string): string[] {
  return graph.edges
    .filter((e) => e.to.startsWith(path))
    .map((e) => e.from.split("#")[0]!)
    .filter((v, i, a) => a.indexOf(v) === i);
}
