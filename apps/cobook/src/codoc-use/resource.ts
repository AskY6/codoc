import type { Workspace } from "@codoc/core";
import type { ResourceRef } from "../chat/types.js";

export function listCodocResources(workspace: Workspace): ResourceRef[] {
  return workspace.listDocs().map((meta) => ({
    kind: "codoc",
    id: meta.docId,
    label: meta.docId,
  }));
}
