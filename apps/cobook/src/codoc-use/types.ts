import type { Intent } from "../chat/types.js";

export type CodocIntentKind =
  | "write-codoc-field"
  | "create-codoc"
  | "rewrite-codoc"
  | "delete-codoc"
  | "force-codoc-field";

export interface WriteFieldPayload {
  docId: string;
  field: string;
  value: unknown;
}

export interface ForceFieldPayload {
  docId: string;
  field: string;
}

export interface CreateCodocPayload {
  docId: string;
  content: string;
}

export interface RewriteCodocPayload {
  docId: string;
  content: string;
  changelog?: string;
}

export interface DeleteCodocPayload {
  docId: string;
}

const CODOC_INTENT_KINDS = new Set<string>([
  "write-codoc-field",
  "create-codoc",
  "rewrite-codoc",
  "delete-codoc",
  "force-codoc-field",
]);

export function isCodocIntent(intent: Intent): boolean {
  return CODOC_INTENT_KINDS.has(intent.kind);
}
