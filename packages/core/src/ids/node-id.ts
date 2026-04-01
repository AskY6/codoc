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

export function parseNodeKey(nodeKey: NodeKey): NodeId | null {
  const separatorIndex = nodeKey.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === nodeKey.length - 1) {
    return null;
  }

  const codocId = nodeKey.slice(0, separatorIndex);
  const rawSectionAndPath = nodeKey.slice(separatorIndex + 1);
  const slashIndex = rawSectionAndPath.indexOf("/");
  const section =
    slashIndex === -1 ? rawSectionAndPath : rawSectionAndPath.slice(0, slashIndex);

  if (!isNodeKind(section)) {
    return null;
  }

  if (slashIndex === -1) {
    return {
      codocId,
      section,
      path: []
    };
  }

  const rawPath = rawSectionAndPath.slice(slashIndex + 1);
  if (rawPath.length === 0) {
    return null;
  }

  const path = rawPath.split("/");
  if (path.some((segment) => segment.length === 0)) {
    return null;
  }

  return {
    codocId,
    section,
    path
  };
}

function isNodeKind(value: string): value is NodeKind {
  return value === "codoc" || value === "data" || value === "view";
}
