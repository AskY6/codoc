import type { Workspace } from "@codoc/core";
import type { ChatAbility, Unsubscribe } from "../chat/index.js";
import { createCodocContextSourceFactory } from "./context.js";
import { executeCodocIntent } from "./intent.js";
import { bridgeWorkspaceEvents } from "./events.js";
import { isCodocIntent } from "./types.js";

export { listCodocResources } from "./resource.js";
export { serializeCodocForLLM, createCodocContextSource } from "./context.js";
export { executeCodocIntent } from "./intent.js";
export { bridgeWorkspaceEvents } from "./events.js";
export { isCodocIntent } from "./types.js";
export type {
  CodocIntentKind,
  WriteFieldPayload,
  ForceFieldPayload,
  CreateCodocPayload,
  DeleteCodocPayload,
} from "./types.js";

export function isFieldStale(
  workspace: Workspace,
  docId: string,
  fieldPath: string,
): boolean {
  try {
    const { tree } = workspace.loadDoc(docId);
    const field = tree.getField(fieldPath);
    return field?.state.status === "dirty";
  } catch {
    return false;
  }
}

export function initCodocUse(
  workspace: Workspace,
  chat: ChatAbility,
  sessionId: string,
): Unsubscribe {
  // Register codoc-snapshot context source factory
  chat.registerContextSourceFactory(
    sessionId,
    createCodocContextSourceFactory(workspace),
  );

  // Listen for confirmed codoc intents and execute them
  const unsubIntent = chat.on(
    sessionId,
    "onIntentStatusChange",
    (msgId, idx, status) => {
      if (status === "confirmed") {
        const intent = chat.getIntent(sessionId, msgId, idx);
        if (isCodocIntent(intent)) {
          executeCodocIntent(workspace, intent);
        }
      }
    },
  );

  // Bridge workspace field change events into chat
  const unsubEvents = bridgeWorkspaceEvents(workspace, chat, sessionId);

  return () => {
    unsubIntent();
    unsubEvents();
  };
}
