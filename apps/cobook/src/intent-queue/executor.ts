import type { Workspace } from "@cobook/workspace";
import { propagateAndInvalidate } from "@cobook/workspace";
import type {
  WriteFieldPayload,
  ForceFieldPayload,
  CreateCodocPayload,
  RewriteCodocPayload,
  IngestPayload,
} from "../codoc-use/types.js";

/**
 * Single canonical intent executor.
 *
 * All intent execution flows converge here. This is the only place that
 * translates intent kind + payload into workspace API calls.
 */
export async function executeIntent(
  workspace: Workspace,
  kind: string,
  payload: unknown,
): Promise<void> {
  switch (kind) {
    case "write-codoc-field": {
      const { docId, field, value } = payload as WriteFieldPayload;
      const { tree, dag } = workspace.loadDoc(docId);
      tree.updateField(field, value);
      const dirtyPaths = propagateAndInvalidate(dag, tree, [field]);
      for (const path of dirtyPaths) {
        await tree.observe(path);
      }
      break;
    }
    case "force-codoc-field": {
      const { docId, field } = payload as ForceFieldPayload;
      const { tree } = workspace.loadDoc(docId);
      tree.refreshField(field);
      await tree.observe(field);
      break;
    }
    case "create-codoc": {
      const { docId, content } = payload as CreateCodocPayload;
      await workspace.createDoc(docId, content);
      workspace.loadDoc(docId);
      break;
    }
    case "rewrite-codoc": {
      const { docId, content } = payload as RewriteCodocPayload;
      await workspace.rewriteDoc(docId, content);
      workspace.loadDoc(docId);
      break;
    }
    case "delete-codoc":
      // TODO: filesystem delete not yet implemented
      break;
    case "ingest": {
      const { skill, path } = payload as IngestPayload;
      await workspace.ingestBySkillName(skill, path);
      break;
    }
  }
}
