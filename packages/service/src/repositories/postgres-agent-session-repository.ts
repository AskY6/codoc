import { resolve } from "node:path";

import { getPostgresDatabase } from "../database/postgres.js";

import type { AgentSessionRecord, AgentSessionRepository } from "./types.js";

interface AgentSessionRow {
  workspace_root: string;
  session_id: string;
  active_scene_id: string | null;
  state: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface PostgresAgentSessionRepositoryOptions {
  connectionString?: string | undefined;
}

export class PostgresAgentSessionRepository implements AgentSessionRepository {
  readonly #database;

  constructor(options: PostgresAgentSessionRepositoryOptions = {}) {
    this.#database = getPostgresDatabase(options.connectionString);
  }

  async getBySessionId(
    workspaceRoot: string,
    sessionId: string
  ): Promise<AgentSessionRecord | null> {
    const pool = await this.#database.ready();
    const result = await pool.query<AgentSessionRow>(
      [
        "SELECT workspace_root, session_id, active_scene_id, state, created_at, updated_at",
        "FROM agent_sessions",
        "WHERE workspace_root = $1 AND session_id = $2",
        "LIMIT 1"
      ].join(" "),
      [normalizeWorkspaceRoot(workspaceRoot), sessionId]
    );
    return result.rows[0] ? mapAgentSessionRow(result.rows[0]) : null;
  }

  async upsert(input: {
    workspaceRoot: string;
    sessionId: string;
    activeSceneId: string | null;
    state: Record<string, unknown>;
  }): Promise<AgentSessionRecord> {
    const pool = await this.#database.ready();
    const result = await pool.query<AgentSessionRow>(
      [
        "INSERT INTO agent_sessions (workspace_root, session_id, active_scene_id, state)",
        "VALUES ($1, $2, $3, $4::jsonb)",
        "ON CONFLICT (workspace_root, session_id) DO UPDATE SET",
        "active_scene_id = EXCLUDED.active_scene_id,",
        "state = EXCLUDED.state,",
        "updated_at = NOW()",
        "RETURNING workspace_root, session_id, active_scene_id, state, created_at, updated_at"
      ].join(" "),
      [
        normalizeWorkspaceRoot(input.workspaceRoot),
        input.sessionId,
        input.activeSceneId,
        JSON.stringify(input.state)
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to upsert agent session in PostgreSQL.");
    }

    return mapAgentSessionRow(row);
  }

  async deleteBySessionId(workspaceRoot: string, sessionId: string): Promise<void> {
    const pool = await this.#database.ready();
    await pool.query("DELETE FROM agent_sessions WHERE workspace_root = $1 AND session_id = $2", [
      normalizeWorkspaceRoot(workspaceRoot),
      sessionId
    ]);
  }
}

function mapAgentSessionRow(row: AgentSessionRow): AgentSessionRecord {
  return {
    workspaceRoot: row.workspace_root,
    sessionId: row.session_id,
    activeSceneId: row.active_scene_id,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot);
}
