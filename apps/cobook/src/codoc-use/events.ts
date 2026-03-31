import type { Workspace, WorkspaceChangeEvent } from "@cobook/workspace";
import type { FieldError } from "@codoc/core";
import { propagateDirty } from "@codoc/graph";
import type { ChatAbility, Unsubscribe } from "../chat/index.js";

const DEFAULT_DEBOUNCE_MS = 2000;
const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 10 * 60_000; // 10 minutes cap
const IDLE_RESET_MS = 15 * 60_000;   // reset counter after 15min idle

interface PendingBatch {
  changed: Map<string, Set<string>>; // docId → set of changed fieldPaths
  stale: Map<string, Set<string>>;   // docId → set of stale fieldPaths
}

export function bridgeWorkspaceEvents(
  workspace: Workspace,
  chat: ChatAbility,
  sessionId: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): Unsubscribe {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let batch: PendingBatch = { changed: new Map(), stale: new Map() };
  const lastNotified = new Map<string, number>();
  const notifyCount = new Map<string, number>();

  /** Exponential cooldown: doubles each time, capped at MAX_COOLDOWN_MS. */
  function effectiveCooldown(key: string, now: number): number {
    const last = lastNotified.get(key);
    // Reset counter after long idle period
    if (last && now - last >= IDLE_RESET_MS) {
      notifyCount.delete(key);
    }
    const count = notifyCount.get(key) ?? 0;
    if (count === 0) return 0; // first notification goes through immediately
    return Math.min(cooldownMs * Math.pow(2, count - 1), MAX_COOLDOWN_MS);
  }

  function recordNotify(key: string, now: number): void {
    lastNotified.set(key, now);
    notifyCount.set(key, (notifyCount.get(key) ?? 0) + 1);
  }

  function flush() {
    timer = null;
    const { changed, stale } = batch;
    batch = { changed: new Map(), stale: new Map() };

    const now = Date.now();

    // Filter out fields notified within their cooldown window
    const filteredChanged = new Map<string, Set<string>>();
    for (const [docId, fields] of changed) {
      for (const field of fields) {
        const key = `${docId}:${field}`;
        const last = lastNotified.get(key);
        const cd = effectiveCooldown(key, now);
        if (!last || now - last >= cd) {
          if (!filteredChanged.has(docId)) filteredChanged.set(docId, new Set());
          filteredChanged.get(docId)!.add(field);
          recordNotify(key, now);
        }
      }
    }

    const filteredStale = new Map<string, Set<string>>();
    for (const [docId, fields] of stale) {
      for (const field of fields) {
        const key = `${docId}:${field}:stale`;
        const last = lastNotified.get(key);
        const cd = effectiveCooldown(key, now);
        if (!last || now - last >= cd) {
          if (!filteredStale.has(docId)) filteredStale.set(docId, new Set());
          filteredStale.get(docId)!.add(field);
          recordNotify(key, now);
        }
      }
    }

    // Collect all affected docIds for resourceRefs
    const docIds = new Set([...filteredChanged.keys(), ...filteredStale.keys()]);

    // Build a single consolidated message
    const lines: string[] = [];
    for (const [docId, fields] of filteredChanged) {
      const paths = [...fields].map((p) => `\`${p}\``).join(", ");
      lines.push(`codoc **${docId}** fields ${paths} changed.`);
    }
    for (const [docId, fields] of filteredStale) {
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
