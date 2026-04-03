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
    ast: jsonb(),
    resolvedValue: jsonb("resolved_value"),
    nodeState: text("node_state").notNull().default("idle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("codocs_ws_path_idx").on(t.workspaceId, t.path)],
);

// ---------------------------------------------------------------------------
// edges (field-level dependency graph)
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
