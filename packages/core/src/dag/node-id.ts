import type { CodocPath, FieldName, NodeId } from "../codoc/ids.js";
import {
  CodocPath as mkCodocPath,
  FieldName as mkFieldName,
  NodeId as mkNodeId,
} from "../codoc/ids.js";

// NodeId encoding: `<codocPath>#data.<fieldName>`
//
// The DAG owns the encoding/decoding because the format couples codocPath
// and fieldName together into the identity used by every edge, invalidate
// walk, and topo sort.

const SEPARATOR = "#data.";

export function makeNodeId(codocPath: CodocPath, fieldName: FieldName): NodeId {
  return mkNodeId(`${codocPath}${SEPARATOR}${fieldName}`);
}

export interface ParsedNodeId {
  readonly codocPath: CodocPath;
  readonly fieldName: FieldName;
}

/**
 * Decode a NodeId back into its parts. Returns `null` for anything that
 * does not match the canonical encoding — callers that need a stricter
 * contract should wrap this in a Result at the boundary.
 */
export function parseNodeId(nodeId: NodeId): ParsedNodeId | null {
  const idx = nodeId.indexOf(SEPARATOR);
  if (idx === -1) return null;

  const pathPart = nodeId.slice(0, idx);
  const fieldPart = nodeId.slice(idx + SEPARATOR.length);
  if (!pathPart || !fieldPart) return null;

  return {
    codocPath: mkCodocPath(pathPart),
    fieldName: mkFieldName(fieldPart),
  };
}
