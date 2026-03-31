# Cobook — Product & Technical Design

> Reactive document platform. Create live, data-driven documents through conversation.

---

## What is Cobook

Cobook is a web application where users create **codocs** — reactive documents that connect to data sources, compute derived values, and render live views. Users interact primarily through chat, where AI agents help create, modify, and analyze documents.

A codoc is not a static file. It is a **running program**: it has a schema (what shape the data takes), loaders (where and how to fetch data), a dependency graph (how fields relate), and a view (how to render the result).

---

## Core Concepts

### Project

A **Project** is the top-level container. It holds documents and conversations.

- Has a name, ID, and settings (connector configs, component library, etc.)
- Contains a flat collection of codocs
- Contains a list of chat sessions
- Is the unit of sharing — share a project, and the recipient sees all its codocs

Analogy: a Claude Code project, a Notion workspace, a GitHub repo.

### Codoc

A **codoc** is a live, reactive document inside a project.

- **Definition** (persistent): schema + loader declarations + view template + components
- **Runtime** (derived): resolved data values, field statuses, dependency graph
- Has a stable ID and a human-readable slug
- Can be created, edited, and deleted — by users or by agents via chat
- Can reference other codocs (cross-doc field dependencies)
- Can connect to external data sources (HTTP, files, APIs, databases)

A codoc is NOT a static file uploaded for reference. It is an active artifact that loads data, resolves dependencies, and renders a live view.

### Chat

A **chat session** is a conversation within a project.

- Multiple chats per project (chat list)
- Each chat can reference codocs as context (like @-mentioning a file)
- Agents in chat can create, modify, and analyze codocs
- Chat history is persistent — survives page refresh and restarts
- Chats are the primary way users interact with the system

### Agent

An **agent** is an AI participant in a chat session.

- Reads context (referenced codocs, connector catalog, user message)
- Proposes structured **intents** (create-codoc, rewrite-codoc, write-field, etc.)
- Intents go through a confirm/reject flow before execution
- Trusted agents can auto-execute without confirmation

---

## User Experience

### Primary Flow

```
User opens Cobook
  → Sees project: list of codocs (left), chat (center), agents (right)
  → Starts a new chat or continues an existing one
  → References codocs as context for the conversation
  → Asks agent to create a dashboard / ingest data / analyze a document
  → Agent proposes changes → user confirms → codoc is created/updated
  → User views the live-rendered codoc
  → Shares the project link with a colleague
```

### Key Interactions

1. **Create via chat**: "Create a dashboard that shows my API response times"
2. **Ingest data**: "Connect to this RSS feed and create a codoc from it"
3. **Analyze**: "Summarize the key decisions in this Claude Code session"
4. **Edit**: "Add a chart component to this dashboard"
5. **Share**: Copy project URL → colleague opens it → sees live codocs
6. **Browse**: Switch between codocs, view dependency graph, check field statuses

---

## Architecture (Web + Future Local Daemon)

### Current Target: Cloud-First Web App

```
Browser ←→ Web Server (Next.js)
                ↓
           Storage Layer (FS → DB)
```

- All state lives on the server: projects, codocs, chats, blobs
- No local daemon required for core functionality
- Data sources: HTTP APIs, uploaded files (blobs), cross-doc refs, LLM generation

### Future Extension: Local Daemon

```
Browser ←→ Web Server ←—WebSocket—→ Local Daemon (user's machine)
                ↓                         ↓
           Cloud Storage            Local filesystem
```

- Daemon is optional — unlocks local file access (watch, ingest)
- Web app works without daemon (upload-based ingest, HTTP sources only)
- Interface designed now so daemon can plug in later without refactoring

---

## Package Architecture

```
@codoc/core          Pure data model + runtime (schema, fields, loaders, state machine)
@codoc/graph         Independent reactive DAG library
@codoc/source        Data source connectors + parsers + auth + cache
@codoc/render        MDX compilation + component registry
@cobook/workspace    Workspace orchestration (lifecycle, wiring, watch, skills)
apps/cobook          Next.js application (UI, API routes, chat, agents)
```

### What Changes

The package structure stays. The changes are in **how state is stored and accessed**:

- `@cobook/workspace` gains a `StorageBackend` abstraction
- `apps/cobook` gains project management, chat persistence, and multi-chat UI
- A new `@cobook/storage` package (or module) provides storage implementations

### What Stays

- `@codoc/core` — no changes, pure runtime model
- `@codoc/graph` — no changes, independent DAG
- `@codoc/source` — no changes, connector + loader system
- `@codoc/render` — no changes, MDX rendering
- Codoc YAML format — no changes
- Agent/intent system — no changes to the model, just persistence added
