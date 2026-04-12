// PostgreSQL error codes relevant to store operations.
// https://www.postgresql.org/docs/current/errcodes-appendix.html

interface PgError {
  code: string;
  constraint_name?: string;
  detail?: string;
}

export function isPgError(e: unknown): e is PgError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as PgError).code === "string"
  );
}

/** 23505 — unique_violation (PK or UNIQUE constraint). */
export function isUniqueViolation(e: unknown): boolean {
  return isPgError(e) && e.code === "23505";
}

/** 23503 — foreign_key_violation. */
export function isForeignKeyViolation(e: unknown): boolean {
  return isPgError(e) && e.code === "23503";
}

/** Extract the constraint name from a PG error, if present. */
export function constraintName(e: unknown): string | undefined {
  return isPgError(e) ? e.constraint_name : undefined;
}
