# Storage Design

---

## Design Principles

1. **Codoc YAML is the source of truth** — the `.codoc` file defines what a document is. Everything else (resolved values, field statuses) is derived state.
2. **Storage is an interface** — the system talks to `StorageBackend`, not to `fs` or `sqlite` directly. Implementations are swappable.
3. **Runtime state is cacheable, not sacred** — snapshots of resolved data improve UX (instant load) but can always be reconstructed from source + loaders.
4. **Local daemon is a future plugin** — interfaces designed now to accommodate it, but not implemented.

---

## Data Model

### Project

```typescript
interface ProjectMeta {
  id: string;            // nanoid, globally unique
  slug: string;          // URL-friendly name, e.g. "backend-team"
  name: string;          // Display name
  createdAt: number;     // epoch ms
  updatedAt: number;
  settings: {
    connectors?: Record<string, ConnectorConfig>;
    componentLibrary?: ComponentLibraryConfig;
  };
}
```

### Doc (codoc identity + content)

```typescript
interface DocRecord {
  id: string;            // nanoid
  slug: string;          // URL-friendly, e.g. "api-dashboard"
  createdAt: number;
  updatedAt: number;
  source: string;        // Raw YAML content (the .codoc file)
}
```

The `source` field is the complete YAML — schema, data, components, view. This is the canonical representation. No structural decomposition in storage.

### Doc Snapshot (runtime cache)

```typescript
interface DocSnapshot {
  docId: string;
  resolvedAt: number;
  fields: Record<string, {
    status: "resolved" | "error";
    value?: unknown;
    error?: string;
  }>;
}
```

Optional. Used to show last-known values before re-running loaders. Can be discarded without data loss.

### Chat

```typescript
interface ChatRecord {
  id: string;            // nanoid
  title: string;         // Auto-generated or user-set
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  references: ResourceRef[];  // Which codocs are referenced in this chat
}

interface ChatMessage {
  id: string;
  parentId: string | null;
  participantId: string;
  content: string;
  intents: Intent[];
  timestamp: number;
}
```

### Blob

```typescript
interface BlobRecord {
  id: string;            // content-hash (sha256) or nanoid
  mimeType: string;
  size: number;
  createdAt: number;
}
```

Blobs store uploaded/ingested raw data. A codoc's loader can reference `blob://{id}` instead of a local file path.

---

## StorageBackend Interface

```typescript
interface StorageBackend {
  // --- Project ---
  getProject(): Promise<ProjectMeta>;
  updateProject(patch: Partial<ProjectMeta>): Promise<void>;

  // --- Docs ---
  listDocs(): Promise<DocRecord[]>;
  getDoc(id: string): Promise<DocRecord | null>;
  getDocBySlug(slug: string): Promise<DocRecord | null>;
  createDoc(doc: Omit<DocRecord, "id" | "createdAt" | "updatedAt">): Promise<DocRecord>;
  updateDoc(id: string, patch: Partial<Pick<DocRecord, "slug" | "source">>): Promise<DocRecord>;
  deleteDoc(id: string): Promise<void>;

  // --- Snapshots ---
  getSnapshot(docId: string): Promise<DocSnapshot | null>;
  putSnapshot(snap: DocSnapshot): Promise<void>;

  // --- Chats ---
  listChats(): Promise<Pick<ChatRecord, "id" | "title" | "createdAt" | "updatedAt">[]>;
  getChat(id: string): Promise<ChatRecord | null>;
  createChat(chat: Omit<ChatRecord, "id" | "createdAt" | "updatedAt">): Promise<ChatRecord>;
  updateChat(id: string, patch: Partial<ChatRecord>): Promise<void>;
  deleteChat(id: string): Promise<void>;

  // --- Blobs ---
  putBlob(data: Buffer, mimeType: string): Promise<BlobRecord>;
  getBlob(id: string): Promise<{ meta: BlobRecord; data: Buffer } | null>;
  deleteBlob(id: string): Promise<void>;
}
```

---

## Implementation: FsStorageBackend

First implementation uses the filesystem. Compatible with current local development workflow.

### Directory Structure

```
{project-root}/
├── project.json                    # ProjectMeta
├── docs/
│   ├── index.json                  # DocRecord[] (without source)
│   ├── {id}.codoc                  # Raw YAML source
│   └── {id}.snapshot.json          # DocSnapshot (optional)
├── chats/
│   ├── index.json                  # ChatRecord[] summary
│   └── {id}.json                   # Full ChatRecord
└── blobs/
    ├── index.json                  # BlobRecord[]
    └── {id}.bin                    # Raw blob data
```

### Why index.json files

- `listDocs()` and `listChats()` need to return metadata without reading every file
- The index is the lightweight catalog; full content is read on demand
- Index is updated atomically on create/update/delete

### Migration from Current Layout

Current layout: `docs/` directory with `{filename}.codoc` files, no index, no project.json.

Migration path:
1. On first boot, if `project.json` doesn't exist, run migration
2. Scan `docs/` for `.codoc` files
3. Assign each an `id` (nanoid) and `slug` (derived from filename, minus `.codoc`)
4. Generate `docs/index.json` and `project.json`
5. Rename files from `{filename}.codoc` to `{id}.codoc`

---

## Implementation: SQLite (Future)

When the app needs multi-user access or deployment to a server:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  settings JSON,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  slug TEXT NOT NULL,
  source TEXT NOT NULL,          -- YAML blob
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(project_id, slug)
);

CREATE TABLE doc_snapshots (
  doc_id TEXT PRIMARY KEY REFERENCES docs(id),
  resolved_at INTEGER,
  fields JSON
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  title TEXT,
  messages JSON,
  references JSON,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE blobs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  mime_type TEXT,
  size INTEGER,
  data BLOB,
  created_at INTEGER
);
```

Same `StorageBackend` interface, different implementation. No application code changes.

---

## Daemon Extension Point

When a local daemon is added in the future, it doesn't replace StorageBackend — it extends the **loader system**.

### What Daemon Provides

```typescript
interface LocalBridge {
  readFile(path: string): Promise<Buffer>;
  watchFile(path: string, onChange: () => void): Unsubscribe;
  listDirectory(path: string): Promise<string[]>;
  watchDirectory(path: string, onChange: (added: string[], removed: string[]) => void): Unsubscribe;
}
```

### How It Integrates

1. A `daemon-file` loader is registered in the loader registry
2. When a codoc has `$source: { connector: "local-file", path: "/some/path" }`, the loader checks:
   - Is a daemon connected? → Read via daemon's WebSocket bridge
   - No daemon? → Return error with message "Connect local daemon to access this file"
3. Ingest flow: daemon reads local files → uploads as blobs → codoc loaders reference blobs
4. Watch flow: daemon watches local files → notifies server on change → server marks fields dirty

### No Storage Changes Needed

The daemon doesn't change how codocs, chats, or projects are stored. It only adds a new data transport for loaders. This is why we design it as a loader-level extension, not a storage-level one.
