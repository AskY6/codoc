import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  description: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// codocs
// ---------------------------------------------------------------------------

export const codocs = pgTable(
  "codocs",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    path: text().notNull(),
    content: text().notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("codocs_ws_path_idx").on(t.workspaceId, t.path)],
);

// ---------------------------------------------------------------------------
// codoc_resolved_fields
//
// One row per resolved DAG node. `state` lives here (not on codocs) so a
// broken ref can pin an error to a single node without dirtying the whole
// codoc. The codoc-level state visible to the UI is derived in the service
// layer by aggregating rows for a given codoc.
//
// The unique (workspace_id, node_id) index acts as the natural cache
// invalidator: `replaceForCodoc` deletes + reinserts per codoc on every
// build, so stale node_ids are evicted automatically when fields are
// removed from source.
// ---------------------------------------------------------------------------

export const codocResolvedFields = pgTable(
  "codoc_resolved_fields",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    codocId: uuid("codoc_id")
      .notNull()
      .references(() => codocs.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    value: jsonb(),
    state: text().notNull(),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("codoc_resolved_fields_ws_node_idx").on(
      t.workspaceId,
      t.nodeId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// edges (field-level dependency graph)
//
// Physical materialized view for getGraph — do NOT use for execution.
// `resolveNode` goes through the in-memory DAG (rebuilt via build()) and
// never consults this table. Edges are rewritten wholesale on each build
// and exist solely so the UI can render the dependency graph without
// recomputing it.
// ---------------------------------------------------------------------------

export const edges = pgTable(
  "edges",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fromNodeId: text("from_node_id").notNull(),
    toNodeId: text("to_node_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("edges_ws_from_to_idx").on(
      t.workspaceId,
      t.fromNodeId,
      t.toNodeId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// chat_threads
// ---------------------------------------------------------------------------

export const chatThreads = pgTable("chat_threads", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// chat_messages
// ---------------------------------------------------------------------------

export const chatMessages = pgTable("chat_messages", {
  id: uuid().primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => chatThreads.id, { onDelete: "cascade" }),
  role: text().notNull(),
  content: text().notNull(),
  agentId: text("agent_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// agent_sessions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// thread_codocs (which codocs are loaded into a chat thread)
// ---------------------------------------------------------------------------

export const threadCodocs = pgTable(
  "thread_codocs",
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    codocId: uuid("codoc_id")
      .notNull()
      .references(() => codocs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("thread_codocs_thread_codoc_idx").on(t.threadId, t.codocId)],
);

// ---------------------------------------------------------------------------
// workspace_agents (default agent set for a workspace)
// ---------------------------------------------------------------------------

export const workspaceAgents = pgTable(
  "workspace_agents",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_agents_ws_agent_idx").on(t.workspaceId, t.agentId)],
);

// ---------------------------------------------------------------------------
// thread_agents (which agents participate in a chat thread)
// ---------------------------------------------------------------------------

export const threadAgents = pgTable(
  "thread_agents",
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("thread_agents_thread_agent_idx").on(t.threadId, t.agentId)],
);

// ---------------------------------------------------------------------------
// agent_sessions
// ---------------------------------------------------------------------------

export const agentSessions = pgTable("agent_sessions", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").references(() => chatThreads.id, {
    onDelete: "set null",
  }),
  activeSceneId: text("active_scene_id"),
  state: jsonb().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
