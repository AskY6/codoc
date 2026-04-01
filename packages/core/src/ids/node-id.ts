export type NodeKind = "data" | "view" | "codoc";

export interface NodeId {
  codocId: string;
  section: NodeKind;
  path: string[];
}

export type NodeKey = string;

export function toNodeKey(node: NodeId): NodeKey {
  const suffix = node.path.length > 0 ? `/${node.path.join("/")}` : "";
  return `${node.codocId}:${node.section}${suffix}`;
}
