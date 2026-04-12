import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import type { DrizzleDb } from "./ctx.js";

export interface PgConnectionOptions {
  readonly connectionString: string;
  readonly max?: number | undefined;
}

export function createConnection(options: PgConnectionOptions): {
  client: postgres.Sql;
  db: DrizzleDb;
} {
  const client = postgres(options.connectionString, {
    max: options.max ?? 10,
  });
  const db = drizzle(client, { schema });
  return { client, db };
}
