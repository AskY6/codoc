# Roadmap

---

## Phase 0: Storage Foundation

**Goal**: Decouple storage from filesystem. No user-visible changes.

### 0.1 — StorageBackend Interface

- [ ] Define `StorageBackend` interface in `@cobook/workspace`
- [ ] Define data types: `ProjectMeta`, `DocRecord`, `DocSnapshot`, `ChatRecord`, `BlobRecord`
- [ ] Implement `FsStorageBackend` (filesystem-based, mirrors current behavior)
- [ ] Unit tests for FsStorageBackend

### 0.2 — Workspace Refactor

- [ ] Refactor `Workspace` class to accept `StorageBackend` via constructor
- [ ] Replace all direct `fs` calls (`readdir`, `readFile`, `writeFile`, `rename`) with backend calls
- [ ] `Workspace.create(backend)` instead of `Workspace.create(dir)`
- [ ] Verify all existing tests pass (behavior unchanged)

### 0.3 — Document ID System

- [ ] Add `id` + `slug` to DocRecord
- [ ] Generate IDs on doc creation (nanoid)
- [ ] Derive slug from user-provided name
- [ ] Update all internal references from filename to ID
- [ ] Update cross-doc `$ref` resolution to use `doc://{id}/path` format
- [ ] Write migration logic: scan existing `.codoc` files → assign IDs → write index
- [ ] Update API routes to use ID/slug instead of filename

### 0.4 — Project Metadata

- [ ] Create `project.json` on first boot (or migration)
- [ ] Store connector configs in `project.json` settings (currently in env/code)
- [ ] `getWorkspace()` reads project config from storage backend

**Deliverable**: Workspace works exactly as before, but reads/writes through StorageBackend. Files on disk have IDs. Project has metadata.

---

## Phase 1: Chat Persistence

**Goal**: Chat survives refresh. Multiple chats per project.

### 1.1 — Chat Storage

- [ ] Add chat methods to `StorageBackend` (already in interface)
- [ ] Implement chat CRUD in `FsStorageBackend` (`chats/` directory)
- [ ] `PersistentChat` wrapper: debounced write on every mutation

### 1.2 — ChatAbility Persistence Bridge

- [ ] On `sendMessage()` → save chat
- [ ] On `updateIntentStatus()` → save chat
- [ ] On `addReference()` / `removeReference()` → save chat
- [ ] On load: reconstruct `MessageTree` from stored messages
- [ ] On load: re-attach agent handlers

### 1.3 — Multi-Chat API

- [ ] `GET /api/chats` — list chats
- [ ] `POST /api/chats` — create new chat
- [ ] `GET /api/chats/{id}` — get chat (load into memory)
- [ ] `DELETE /api/chats/{id}` — delete chat
- [ ] Refactor `getChatAbility()` from singleton to per-chat factory

### 1.4 — Chat List UI

- [ ] Chat list component in sidebar (below or tabbed with Resources)
- [ ] New chat button
- [ ] Switch chat (save current, load target)
- [ ] Auto-create default chat on first visit
- [ ] Auto-title from first message

**Deliverable**: Users can create multiple chats, switch between them, and all state persists across refresh/restart.

---

## Phase 2: Blob Storage & Web Ingest

**Goal**: Users can upload data files via browser. Ingest works without local filesystem access.

### 2.1 — Blob Storage

- [ ] Implement blob methods in `FsStorageBackend` (`blobs/` directory)
- [ ] Content-hash based IDs (SHA-256)
- [ ] Upload API: `POST /api/blobs` (multipart form data)
- [ ] Download API: `GET /api/blobs/{id}`

### 2.2 — Blob Connector

- [ ] Register `blob` connector in `@codoc/source`
- [ ] Blob connector reads from `StorageBackend.getBlob(id)`
- [ ] Supports parsers: json, jsonl, csv, text
- [ ] Codoc YAML format: `$source: { connector: blob, id: "sha256-...", parser: jsonl }`

### 2.3 — Upload-Based Ingest Flow

- [ ] UI: file upload button (or drag-and-drop area)
- [ ] On upload: store blob, return blob ID
- [ ] Agent creates codoc with `blob` connector referencing the uploaded data
- [ ] Skill system updated: skills can produce `blob`-based loader declarations

### 2.4 — Snapshot Persistence

- [ ] Save snapshots to storage on field resolution (debounced)
- [ ] Load snapshots on codoc load (hydrate fields before loaders run)
- [ ] Stale-while-revalidate: show cached data, update in background

**Deliverable**: Users can upload files via browser, agents create codocs from uploaded data, codoc data persists across restarts.

---

## Phase 3: Web-Native Experience

**Goal**: Shareable URLs, polished multi-chat UX, public viewing.

### 3.1 — URL Routing

- [ ] `/doc/{slug}` — codoc view page
- [ ] `/doc/{slug}/source` — codoc YAML source view
- [ ] `/chat/{id}` — chat session page
- [ ] `/` — project home (default chat + doc list)
- [ ] Browser back/forward navigation support

### 3.2 — Sharing

- [ ] Project-level sharing: share URL gives access to all codocs + chats
- [ ] Individual codoc sharing: direct link to a rendered codoc
- [ ] Read-only mode for viewers (no edit, no chat)

### 3.3 — UI Polish

- [ ] Chat list with search/filter
- [ ] Chat title editing
- [ ] Codoc rename via slug edit
- [ ] Empty states for new projects
- [ ] Keyboard shortcuts (new chat, switch chat, etc.)

**Deliverable**: Cobook feels like a real web app — shareable URLs, persistent state, polished navigation.

---

## Phase 4: Production Storage (Future)

**Goal**: Move from filesystem to database for multi-user deployment.

### 4.1 — SQLite Backend

- [ ] Implement `SqliteStorageBackend`
- [ ] Migration scripts from FS layout to SQLite
- [ ] Config flag to choose backend: `STORAGE_BACKEND=fs|sqlite`

### 4.2 — Multi-Project

- [ ] Project list / project switcher
- [ ] Project creation flow
- [ ] Per-project isolation

### 4.3 — Authentication

- [ ] User identity (OAuth or API key)
- [ ] Project membership
- [ ] Per-project permissions (owner / editor / viewer)

---

## Phase 5: Local Daemon (Future)

**Goal**: Access local files from the web app.

### 5.1 — Daemon Process

- [ ] Standalone Node.js process (CLI: `cobook daemon start`)
- [ ] Connects to web server via WebSocket
- [ ] Authenticates with project token

### 5.2 — Local Bridge

- [ ] `readFile`, `watchFile`, `listDirectory`, `watchDirectory` over WebSocket
- [ ] `daemon-file` connector registered in loader system
- [ ] Fallback: if daemon disconnects, show "daemon offline" for local-file fields

### 5.3 — Auto-Ingest

- [ ] Daemon watches configured directories
- [ ] New files → auto-upload as blobs → notify server
- [ ] Server creates codocs from uploaded blobs (via skill matching)

---

## Dependency Graph

```
Phase 0 (Storage Foundation)
    ↓
Phase 1 (Chat Persistence)      ← can start after 0.1-0.2
    ↓
Phase 2 (Blob + Web Ingest)     ← can start after 0.1-0.2, parallel with Phase 1
    ↓
Phase 3 (Web Experience)        ← needs Phase 1 + 2
    ↓
Phase 4 (Production Storage)    ← needs Phase 3
    ↓
Phase 5 (Local Daemon)          ← independent, needs Phase 2 (blob system)
```

Phase 1 and Phase 2 can run in parallel after Phase 0 core (0.1 + 0.2) is done.
