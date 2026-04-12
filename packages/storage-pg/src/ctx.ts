import type { Ctx } from "@cobook/storage";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";

/** The Drizzle query surface shared by both the base db and a transaction. */
export type DrizzleDb = PostgresJsDatabase<typeof schema>;

export interface PgCtx extends Ctx {
  readonly __brand: "StorageCtx";
  readonly db: DrizzleDb;
}

/** Extract the Drizzle handle from an opaque Ctx. */
export function pgDb(ctx: Ctx): DrizzleDb {
  return (ctx as PgCtx).db;
}

export function pgCtx(db: DrizzleDb): PgCtx {
  return { __brand: "StorageCtx" as const, db };
}
