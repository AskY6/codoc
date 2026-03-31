# Codoc Runtime & Snapshot Design

---

## The Two Layers of a Codoc

A codoc has a **definition** and a **runtime**. This distinction is central to the architecture.

### Definition (Persistent)

The `.codoc` YAML file. Contains:
- `meta.data` — JSON Schema describing field shapes
- `data` — Field values and loader declarations (`$source`, `$ref`, `$prompt`, literals)
- `view` — MDX template
- `components` — Optional component bundle references

**Stored in**: `StorageBackend.getDoc(id).source`
**Changes when**: User or agent edits the codoc (low frequency)
**Format**: YAML string (blob), not decomposed

### Runtime (Derived)

The in-memory state after loading and running a codoc. Contains:
- `DataTree` — Field map with resolved values and statuses
- `DAG` — Dependency graph between fields
- Loader subscriptions, watcher bindings, cross-doc wiring

**Stored in**: Memory (server process)
**Changes when**: Loaders resolve, watchers fire, dependencies cascade (high frequency)
**Not persisted** — reconstructed on load from definition + data sources

### Snapshot (Cache)

A point-in-time capture of the runtime state. Contains:
- Resolved field values
- Field statuses
- Timestamp

**Stored in**: `StorageBackend.putSnapshot()`
**Purpose**: Show last-known data immediately on load, before loaders re-run
**Can be discarded**: No data loss — just means a fresh load takes longer

---

## Codoc Lifecycle

```
                    ┌──────────────────────┐
                    │     Definition       │
                    │   (YAML in storage)   │
                    └──────────┬───────────┘
                               │ loadDoc()
                               ▼
                    ┌──────────────────────┐
                    │      Runtime         │
                    │  (DataTree + DAG)     │
              ┌─────┤   Status: loaded     ├─────┐
              │     └──────────────────────┘     │
              │                                   │
        force fields                        field change
              │                                   │
              ▼                                   ▼
     ┌────────────────┐                ┌──────────────────┐
     │   Loaders run   │                │  Mark dirty +     │
     │   Values resolve │                │  re-force         │
     └────────┬───────┘                └──────────────────┘
              │
              ▼
     ┌────────────────┐
     │  Save snapshot  │ (async, debounced)
     └────────────────┘
```

### Load

1. Read `DocRecord.source` from storage
2. `parseCodoc(source)` → `CodocFile`
3. Create `DataTree` from schema + data
4. Build `DAG` from dependency analysis
5. Wire cross-doc dependencies
6. Register in `DocRegistry`
7. If snapshot exists, hydrate fields with cached values (status = "stale")
8. Force all fields (loaders run, values resolve)
9. Save new snapshot

### Edit (rewrite)

1. Agent or user provides new YAML
2. `parseCodoc(newSource)` — validates structure
3. `StorageBackend.updateDoc(id, { source: newSource })`
4. Tear down existing runtime (unsubscribe watchers, remove from registry)
5. Re-run Load sequence with new source

### Delete

1. Tear down runtime
2. `StorageBackend.deleteDoc(id)`
3. Remove snapshot
4. Optionally GC orphaned blobs

---

## Snapshot Strategy

### When to Snapshot

After every successful field resolution, debounced:
- Field resolves → schedule snapshot save (500ms debounce)
- Multiple fields resolve in quick succession → single snapshot write

### What to Snapshot

All fields with `status: "resolved"` or `status: "error"`:

```json
{
  "docId": "x7k9m2p4",
  "resolvedAt": 1711843200000,
  "fields": {
    "/messages": {
      "status": "resolved",
      "value": [...]
    },
    "/summary": {
      "status": "error",
      "error": "LLM rate limit exceeded"
    },
    "/title": {
      "status": "resolved",
      "value": "Session Analysis"
    }
  }
}
```

### Snapshot Hydration

When loading a codoc that has a snapshot:

1. Create DataTree as usual
2. For each field in snapshot:
   - Set field value from snapshot
   - Set field status to `"resolved"` (or `"error"`)
   - Mark as `stale` internally (needs re-validation)
3. Return the hydrated tree immediately (UI shows cached data)
4. In background, force all fields (loaders re-run)
5. If new values differ from snapshot → update UI via SSE
6. Save new snapshot

This gives the user **instant load** with **eventual freshness**.

---

## Blob-Based Ingest (No Daemon)

Without a local daemon, ingest works via file upload:

### Flow

```
User uploads file (browser) → POST /api/blobs → Server stores blob
  → Agent creates codoc with loader: { $source: { connector: "blob", id: "{hash}" } }
  → Loader reads blob from StorageBackend
  → Field resolves with parsed data
```

### Blob Loader

A new built-in connector: `blob`

```yaml
data:
  messages:
    $source:
      connector: blob
      id: "sha256-abc123..."
      parser: jsonl
```

The `blob` connector reads from `StorageBackend.getBlob(id)` and applies the specified parser. It's the web-native equivalent of the `local-file` connector.

### Upload API

```
POST /api/blobs
Content-Type: multipart/form-data
Body: file

Response: { id: "sha256-abc123...", mimeType: "application/jsonl", size: 42000 }
```

### Future Daemon Integration

When a daemon is connected:
1. Daemon can auto-upload local files as blobs
2. Or: a `daemon-file` connector reads files directly via the daemon bridge
3. Codocs created via daemon ingest use `daemon-file` connector (falls back to `blob` if daemon disconnects)

The blob system works with or without a daemon. The daemon just adds convenience (auto-ingest instead of manual upload).
