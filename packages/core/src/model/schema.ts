import type { FieldError } from "./data.js";

// --- Validation Result Types ---

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: FieldError & { kind: "validation" };
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;
