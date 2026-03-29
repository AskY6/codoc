import type { Workspace } from "@codoc/core";
import { propagateAndInvalidate } from "@codoc/core";
import type { Intent } from "../chat/types.js";
import type {
  WriteFieldPayload,
  ForceFieldPayload,
} from "./types.js";

export async function executeCodocIntent(
  workspace: Workspace,
  intent: Intent,
): Promise<void> {
  switch (intent.kind) {
    case "write-codoc-field": {
      const { docId, field, value } = intent.payload as WriteFieldPayload;
      const { tree, dag } = workspace.loadDoc(docId);
      tree.updateField(field, value);
      const dirtyPaths = propagateAndInvalidate(dag, tree, [field]);
      for (const path of dirtyPaths) {
        await tree.observe(path);
      }
      break;
    }
    case "force-codoc-field": {
      const { docId, field } = intent.payload as ForceFieldPayload;
      const { tree } = workspace.loadDoc(docId);
      tree.refreshField(field);
      await tree.observe(field);
      break;
    }
    case "create-codoc":
    case "delete-codoc":
      // TODO: filesystem operations not yet exposed by Workspace API
      break;
  }
}
