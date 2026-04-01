import { Pool, type PoolClient } from "pg";

import { resolvePostgresConnectionString } from "./config.js";

const MIGRATION_LOCK_ID = 4_284_201;

interface MigrationDefinition {
  id: string;
  sql: string;
}

export interface PostgresDatabase {
  connectionString: string;
  pool: Pool;
  ready(): Promise<Pool>;
  close(): Promise<void>;
}

const databases = new Map<string, PostgresDatabase>();
const migrations = new Map<string, Promise<void>>();

const MIGRATIONS: MigrationDefinition[] = [
  {
    id: "0001_initial_business_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        workspace_root TEXT NOT NULL,
        document_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        document_kind TEXT NOT NULL DEFAULT 'codoc',
        title TEXT,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_root, document_id),
        UNIQUE (workspace_root, source_path)
      );

      CREATE INDEX IF NOT EXISTS documents_workspace_kind_idx
        ON documents (workspace_root, document_kind);

      CREATE TABLE IF NOT EXISTS chat_threads (
        workspace_root TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        title TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_root, thread_id)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        workspace_root TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL,
        agent_id TEXT,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_root, thread_id, message_id),
        FOREIGN KEY (workspace_root, thread_id)
          REFERENCES chat_threads (workspace_root, thread_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx
        ON chat_messages (workspace_root, thread_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_sessions (
        workspace_root TEXT NOT NULL,
        session_id TEXT NOT NULL,
        active_scene_id TEXT,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_root, session_id)
      );
    `
  },
  {
    id: "0002_drop_platform_rss_tables",
    sql: `
      DROP TABLE IF EXISTS rss_articles;
      DROP TABLE IF EXISTS rss_sources;
    `
  }
];

export function getPostgresDatabase(connectionString?: string): PostgresDatabase {
  const resolvedConnectionString = resolvePostgresConnectionString({
    connectionString
  });
  const existing = databases.get(resolvedConnectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({
    connectionString: resolvedConnectionString,
    max: 10
  });

  const database: PostgresDatabase = {
    connectionString: resolvedConnectionString,
    pool,
    async ready() {
      await ensureDatabaseReady(resolvedConnectionString, pool);
      return pool;
    },
    async close() {
      databases.delete(resolvedConnectionString);
      migrations.delete(resolvedConnectionString);
      await pool.end();
    }
  };
  databases.set(resolvedConnectionString, database);
  return database;
}

export async function closeAllPostgresDatabases(): Promise<void> {
  await Promise.all(Array.from(databases.values(), (database) => database.close()));
}

async function ensureDatabaseMigrated(connectionString: string, pool: Pool): Promise<void> {
  const existing = migrations.get(connectionString);
  if (existing) {
    return existing;
  }

  const pending = runMigrations(pool).catch((error) => {
    migrations.delete(connectionString);
    throw error;
  });
  migrations.set(connectionString, pending);
  return pending;
}

async function ensureDatabaseReady(connectionString: string, pool: Pool): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ensureDatabaseMigrated(connectionString, pool);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableConnectionError(error) || attempt === 2) {
        throw error;
      }

      await delay(250 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    for (const migration of MIGRATIONS) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
        migration.id
      ]);
      if (existing.rowCount) {
        continue;
      }

      await runMigration(client, migration);
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}

async function runMigration(client: PoolClient, migration: MigrationDefinition): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function isRetriableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /(Connection terminated unexpectedly|ECONNREFUSED|ECONNRESET|terminating connection)/i.test(
    error.message
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
