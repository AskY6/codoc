// `mapServiceError` — single source of truth for the HTTP envelope.
//
// Every route in this app pattern-matches a `ServiceError` here, never
// inside the route handler. Two reasons:
//
//   1. The mapping is uniform across endpoints. The route shouldn't
//      have to remember whether `workspace-already-exists` is 409 or 422.
//   2. The default arm is exhaustive — if a future `ServiceError`
//      variant is added without a matching arm, TypeScript fails the
//      build, forcing every new error type to be deliberately mapped.
//
// Wire shape: `{ error: { kind: string, ...details } }`.
//   - `kind` matches the ServiceError discriminator so the client can
//     pattern-match without re-parsing the prose.
//   - The other fields carry whatever context the variant defines.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ServiceError } from "@cobook/service";

export interface MappedError {
  readonly status: ContentfulStatusCode;
  readonly body: { readonly error: ServiceError };
}

export function mapServiceError(error: ServiceError): MappedError {
  return {
    status: statusFor(error),
    body: { error },
  };
}

/**
 * Convenience: write a `MappedError` directly into a Hono context.
 * Routes call this so they don't have to thread the status type
 * through their handler signature.
 */
export function respondError(c: Context, error: ServiceError) {
  const mapped = mapServiceError(error);
  return c.json(mapped.body, mapped.status);
}

function statusFor(error: ServiceError): ContentfulStatusCode {
  switch (error.kind) {
    // 404 — not found
    case "workspace-not-found":
    case "agent-not-found":
    case "codoc-not-found":
    case "thread-not-found":
    case "message-not-found":
    case "session-not-found":
      return 404;

    // 409 — already exists / optimistic conflict / structural refusal
    case "workspace-already-exists":
    case "agent-already-exists":
    case "codoc-already-exists":
    case "thread-already-exists":
    case "workspace-conflict":
    case "agent-conflict":
    case "codoc-conflict":
    case "thread-conflict":
    case "session-conflict":
    case "codoc-referenced":
    case "thread-codoc-workspace-mismatch":
      return 409;

    // 503 — infra
    case "storage-unavailable":
      return 503;
  }
}
