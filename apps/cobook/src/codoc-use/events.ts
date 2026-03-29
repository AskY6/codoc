import type { Workspace, WorkspaceChangeEvent } from "@codoc/core";
import { propagateDirty } from "@codoc/core";
import type { ChatAbility, Unsubscribe } from "../chat/index.js";

export function bridgeWorkspaceEvents(
  workspace: Workspace,
  chat: ChatAbility,
  sessionId: string,
): Unsubscribe {
  return workspace.onFieldChange((event: WorkspaceChangeEvent) => {
    chat.sendMessage(sessionId, {
      sender: { id: "system", kind: "agent" },
      content: `codoc **${event.docId}** field \`${event.fieldPath}\` changed.`,
      resourceRefs: [{ kind: "codoc", id: event.docId }],
    });

    // Compute downstream stale fields from DAG
    try {
      const { dag } = workspace.loadDoc(event.docId);
      const stalePaths = propagateDirty(dag, [event.fieldPath]);
      for (const stalePath of stalePaths) {
        chat.sendMessage(sessionId, {
          sender: { id: "system", kind: "agent" },
          content: `downstream codoc **${event.docId}** field \`${stalePath}\` marked stale.`,
          resourceRefs: [{ kind: "codoc", id: event.docId }],
        });
      }
    } catch {
      // Doc may not be loaded yet — skip downstream notifications
    }
  });
}
