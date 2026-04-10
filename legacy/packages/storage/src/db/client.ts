import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;

// A write-capable drizzle handle: either the top-level Database or a
// transaction handle inside `db.transaction(async (tx) => ...)`. Repositories
// accept this union so the same repo code runs both in and out of a
// transaction.
export type DbExecutor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return Object.assign(drizzle(pool, { schema }), { $pool: pool });
}
