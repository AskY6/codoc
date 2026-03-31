# Project & Identity Design

---

## Project

### Lifecycle

```
Create project → Add codocs (via chat or manual) → Share → Collaborate
```

### Single-Project Mode (Phase 1)

The web server hosts one project. `project.json` lives in the project root directory. No project switching UI.

This matches the current single-workspace model. The difference: the project now has explicit metadata and persistent configuration, rather than being an implicit directory.

### Multi-Project Mode (Future)

When needed, the server can host multiple projects. Each project is a row in the database with its own set of docs and chats. Not designed now, but the data model supports it (every record has a `project_id` foreign key in the SQLite schema).

---

## Document Identity

### Current Problem

DocId = filename (e.g., `session-aaa.codoc`). This causes:
- Filenames are fragile identifiers (rename breaks all references)
- No URL-friendly slugs (filenames can have weird characters)
- Cross-doc `$ref` uses filenames, which couples data to storage layout

### New Model

Every codoc has:

| Field | Purpose | Example |
|-------|---------|---------|
| `id` | Stable, opaque, never changes | `"x7k9m2p4"` |
| `slug` | URL-friendly, human-readable, renameable | `"api-dashboard"` |

**ID** is generated on creation (nanoid) and never changes. All internal references (cross-doc `$ref`, chat references, dependency graph) use ID.

**Slug** is derived from the user-facing name. It appears in URLs (`/project/my-team/doc/api-dashboard`) and in the UI. Users can rename it.

### Cross-Doc References

Current format in codoc YAML:
```yaml
data:
  summary:
    $ref: "other-doc.codoc#/messages"
```

New format:
```yaml
data:
  summary:
    $ref: "doc://x7k9m2p4/messages"
```

Or with slug (resolved at load time):
```yaml
data:
  summary:
    $ref: "doc://api-dashboard/messages"
```

The resolver normalizes slug → ID at parse time. Internal runtime always uses IDs.

### URL Structure

```
/                                    → Project home (chat list + doc list)
/doc/{slug}                          → Codoc view (rendered)
/doc/{slug}/source                   → Codoc source (YAML editor)
/chat/{id}                           → Chat session
```

Public sharing (future):
```
/public/{projectSlug}/{docSlug}      → Public read-only codoc view
```

---

## Chat Identity

### Current Problem

Single chat session, no persistence. Refresh loses everything.

### New Model

Each chat has:

| Field | Purpose | Example |
|-------|---------|---------|
| `id` | Stable identifier | `"c3n8f1q7"` |
| `title` | Auto-generated, editable | `"API Dashboard Setup"` |

Chat list is shown in the UI. Users can:
- Start a new chat
- Switch between chats
- See chat history
- Delete old chats

### Auto-Titling

When a chat has no explicit title, auto-generate from the first user message (truncated). Can be overridden by the user.

---

## Blob Identity

Blobs are identified by content hash (SHA-256). This gives:
- Deduplication: same file uploaded twice = same blob
- Integrity: blob ID verifies content hasn't been corrupted
- Immutability: blobs are never updated, only created or deleted

### Blob Lifecycle

```
Upload/Ingest → Store as blob → Codoc references blob://{hash} → Blob persists
Delete codoc → If no other codoc references blob → Blob eligible for GC
```

Garbage collection is optional and can be deferred. Blobs are typically small (KB-MB range for JSONL logs, CSV data, etc.).

---

## Migration Strategy

### From Current (filename-based) to New (ID-based)

The migration runs once on first boot after the update:

1. Check if `project.json` exists. If yes, already migrated.
2. Scan `docs/` for `*.codoc` files.
3. For each file:
   - Generate `id` (nanoid)
   - Derive `slug` from filename: `"session-aaa.codoc"` → `"session-aaa"`
   - Read YAML content as `source`
   - Create `DocRecord` entry
4. Write `docs/index.json` with all DocRecords.
5. Rename files: `session-aaa.codoc` → `{id}.codoc`.
6. Generate `project.json` with default name and empty settings.
7. Create empty `chats/index.json`.

### Backward Compatibility

- The YAML format inside `.codoc` files does not change
- `parseCodoc()` / `serializeCodoc()` work as before
- The runtime (`DataTree`, `DAG`, loaders) is unaffected
- Only the Workspace class changes: it reads from `StorageBackend` instead of directly from `fs`
