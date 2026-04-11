// Tiny wrapper around `fetch` that:
//   1. Threads JSON content type / accept headers
//   2. Parses the server's `{ error: { kind, ... } }` envelope on
//      non-2xx and throws an `ApiError` with the structured payload
//   3. Returns a typed JSON body on 2xx
//
// Routes call `apiFetch<T>(path, init?)` and let react-query catch the
// throw via its built-in error handling.

import type { ServiceErrorBody } from "../types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string,
    readonly details: Record<string, unknown>,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const body = await safeJson(res);
    if (isServiceErrorBody(body)) {
      const { kind, ...rest } = body.error;
      throw new ApiError(
        res.status,
        kind,
        rest,
        `request failed: ${kind} (${res.status})`,
      );
    }
    throw new ApiError(
      res.status,
      "unknown",
      { body },
      `request failed with status ${res.status}`,
    );
  }

  return (await res.json()) as T;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isServiceErrorBody(value: unknown): value is ServiceErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null &&
    "kind" in (value as { error: { kind: unknown } }).error &&
    typeof (value as { error: { kind: unknown } }).error.kind === "string"
  );
}
