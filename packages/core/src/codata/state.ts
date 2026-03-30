import type { FieldState, FieldError } from "../model/data.js";

/**
 * Transition a field to pending state.
 */
export function toPending(): FieldState<unknown> {
  return { status: "pending" };
}

/**
 * Transition a field to resolved state.
 */
export function toResolved<T>(value: T): FieldState<T> {
  return { status: "resolved", value };
}

/**
 * Transition a field to error state.
 */
export function toError(error: FieldError): FieldState<never> {
  return { status: "error", error };
}

/**
 * Transition a field to dirty state.
 * Only valid from resolved or error states.
 */
export function toDirty(): FieldState<unknown> {
  return { status: "dirty" };
}

/**
 * Check if a field can be marked dirty (only from resolved or error).
 */
export function canMarkDirty(state: FieldState<unknown>): boolean {
  return state.status === "resolved" || state.status === "error";
}

/**
 * Check if a field needs forcing (idle or dirty).
 */
export function needsForce(state: FieldState<unknown>): boolean {
  return state.status === "idle" || state.status === "dirty";
}
