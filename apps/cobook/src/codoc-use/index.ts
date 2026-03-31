import type { Workspace } from "@cobook/workspace";
import type { ChatAbility, Unsubscribe } from "../chat/index.js";
import {
  createCodocContextSourceFactory,
  createConnectorContextSource,
} from "./context.js";
import { bridgeWorkspaceEvents, bridgeConnectorAuthErrors } from "./events.js";

export { listCodocResources } from "./resource.js";
export {
  serializeCodocForLLM,
  createCodocContextSource,
  createConnectorContextSource,
} from "./context.js";
export { bridgeWorkspaceEvents, bridgeConnectorAuthErrors } from "./events.js";
export { isCodocIntent } from "./types.js";
export type {
  CodocIntentKind,
  WriteFieldPayload,
  ForceFieldPayload,
  CreateCodocPayload,
  RewriteCodocPayload,
  DeleteCodocPayload,
  IngestPayload,
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

/**
 * Register context sources and event bridges for the chat layer.
 *
 * This does NOT handle intent execution — that is handled by
 * the agent system via chat intent confirmation.
 */
export function initCodocUse(
  workspace: Workspace,
  chat: ChatAbility,
  sessionId: string,
): Unsubscribe {
  chat.registerContextSourceFactory(
    sessionId,
    createCodocContextSourceFactory(workspace),
  );

  chat.registerContextSource(sessionId, createConnectorContextSource());

  const unsubEvents = bridgeWorkspaceEvents(workspace, chat, sessionId);
  const unsubAuthErrors = bridgeConnectorAuthErrors(
    workspace,
    chat,
    sessionId,
  );

  return () => {
    unsubEvents();
    unsubAuthErrors();
  };
}
