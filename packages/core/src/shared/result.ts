// Result<T, E> — explicit success/failure sum type. Pure core functions
// return this instead of throwing so that callers must handle both branches.

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
  r: Result<T, E>,
): r is { readonly ok: true; readonly value: T } => r.ok;

export const isErr = <T, E>(
  r: Result<T, E>,
): r is { readonly ok: false; readonly error: E } => !r.ok;
