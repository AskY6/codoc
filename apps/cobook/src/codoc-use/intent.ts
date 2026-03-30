import type { Workspace } from "@cobook/workspace";
import { propagateAndInvalidate } from "@cobook/workspace";
import type { Intent } from "../chat/types.js";
import type {
  WriteFieldPayload,
  ForceFieldPayload,
  CreateCodocPayload,
  RewriteCodocPayload,
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
    case "create-codoc": {
      const { docId, content } = intent.payload as CreateCodocPayload;
      await workspace.createDoc(docId, content);
      workspace.loadDoc(docId);
      break;
    }
    case "rewrite-codoc": {
      const { docId, content } = intent.payload as RewriteCodocPayload;
      await workspace.rewriteDoc(docId, content);
      workspace.loadDoc(docId);
      break;
    }
    case "delete-codoc":
      // TODO: filesystem delete not yet implemented
      break;
  }
}
