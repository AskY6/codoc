import type { Workspace, WorkspaceChangeEvent, FieldError } from "@codoc/core";
import { propagateDirty } from "@codoc/core";
import type { ChatAbility, Unsubscribe } from "../chat/index.js";

const DEFAULT_DEBOUNCE_MS = 2000;

interface PendingBatch {
  changed: Map<string, Set<string>>; // docId → set of changed fieldPaths
  stale: Map<string, Set<string>>;   // docId → set of stale fieldPaths
}

export function bridgeWorkspaceEvents(
  workspace: Workspace,
  chat: ChatAbility,
  sessionId: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): Unsubscribe {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let batch: PendingBatch = { changed: new Map(), stale: new Map() };

  function flush() {
    timer = null;
    const { changed, stale } = batch;
    batch = { changed: new Map(), stale: new Map() };

    // Collect all affected docIds for resourceRefs
    const docIds = new Set([...changed.keys(), ...stale.keys()]);

    // Build a single consolidated message
    const lines: string[] = [];
    for (const [docId, fields] of changed) {
      const paths = [...fields].map((p) => `\`${p}\``).join(", ");
      lines.push(`codoc **${docId}** fields ${paths} changed.`);
    }
    for (const [docId, fields] of stale) {
      const paths = [...fields].map((p) => `\`${p}\``).join(", ");
      lines.push(`downstream **${docId}** fields ${paths} marked stale.`);
    }

    if (lines.length === 0) return;

    chat.sendMessage(sessionId, {
      sender: { id: "system", kind: "agent" },
      content: lines.join("\n"),
      resourceRefs: [...docIds].map((id) => ({ kind: "codoc", id })),
    });
  }

  const unsub = workspace.onFieldChange((event: WorkspaceChangeEvent) => {
    // Accumulate changed field
    if (!batch.changed.has(event.docId)) {
      batch.changed.set(event.docId, new Set());
    }
    batch.changed.get(event.docId)!.add(event.fieldPath);

    // Accumulate downstream stale fields
    try {
      const { dag } = workspace.loadDoc(event.docId);
      const stalePaths = propagateDirty(dag, [event.fieldPath]);
      if (stalePaths.length > 0) {
        if (!batch.stale.has(event.docId)) {
          batch.stale.set(event.docId, new Set());
        }
        const set = batch.stale.get(event.docId)!;
        for (const p of stalePaths) set.add(p);
      }
    } catch {
      // Doc may not be loaded yet — skip downstream notifications
    }

    // Reset debounce timer
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}

/**
 * Watch for connector auth errors and send a one-time guidance message per connector.
 * Fires immediately (not debounced) on first auth failure detection.
 */
export function bridgeConnectorAuthErrors(
  workspace: Workspace,
  chat: ChatAbility,
  sessionId: string,
): Unsubscribe {
  const notified = new Set<string>();

  const unsub = workspace.onFieldChange((event: WorkspaceChangeEvent) => {
    try {
      const { tree } = workspace.loadDoc(event.docId);
      const field = tree.getField(event.fieldPath);
      if (!field || field.state.status !== "error") return;

      const error = field.state.error as FieldError;
      if (error.kind !== "source") return;

      const msg = error.message;
      if (!msg.includes("认证未配置")) return;

      // Extract connector name from the field's loader declaration
      const decl = field.meta.loader;
      if (decl.type !== "source" || typeof decl.$source === "string") return;
      const connectorName = decl.$source.connector;

      // Only send guidance once per connector per session
      if (notified.has(connectorName)) return;
      notified.add(connectorName);

      chat.sendMessage(sessionId, {
        sender: { id: "system", kind: "agent" },
        content: `字段 \`${event.fieldPath}\` 需要 **${connectorName}** 认证。请配置后重试：\n\n\`\`\`yaml\n# docs/.cobook/credentials.yaml\n${connectorName}:\n  appId: your_app_id\n  appSecret: your_app_secret\n\`\`\`\n\n或设置环境变量 \`FEISHU_APP_ID\` 和 \`FEISHU_APP_SECRET\`。`,
        resourceRefs: [{ kind: "codoc", id: event.docId }],
      });
    } catch {
      // Doc not loaded yet — skip
    }
  });

  return unsub;
}
