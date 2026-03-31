# Code Change Map

Where each change lands in the current codebase.

---

## Packages Not Touched

These packages have no changes in Phase 0-2:

| Package | Reason |
|---------|--------|
| `@codoc/core` | Pure data model + runtime. Storage-agnostic. |
| `@codoc/graph` | Independent DAG library. No storage dependency. |
| `@codoc/render` | MDX compilation. No storage dependency. |

---

## `@codoc/source` — Minor Addition

### New: Blob Connector (Phase 2)

```
packages/source/src/
├── connectors/
│   └── blob.ts               ← NEW: reads from StorageBackend.getBlob()
```

The blob connector needs access to the storage backend. Since `@codoc/source` shouldn't depend on `@cobook/workspace`, inject the blob reader as a factory parameter:

```typescript
// packages/source/src/connectors/blob.ts
export function createBlobConnector(
  readBlob: (id: string) => Promise<Buffer | null>
): ConnectorFn { ... }
```

Registered during workspace bootstrap, with the concrete `StorageBackend.getBlob` bound.

---

## `@cobook/workspace` — Major Refactor

### New Files

```
packages/workspace/src/
├── storage/
│   ├── types.ts               ← StorageBackend interface + data types
│   ├── fs-backend.ts          ← FsStorageBackend implementation
│   └── migration.ts           ← Migrate from current layout to new layout
```

### Modified Files

| File | Change |
|------|--------|
| `api/workspace-api.ts` | Accept `StorageBackend` in constructor. Replace all `fs` calls. |
| `api/types.ts` | Add `DocRecord`, `ProjectMeta` types (or re-export from storage/types). |
| `lifecycle/codoc-factory.ts` | No change (parse/serialize YAML). |
| `lifecycle/instance-store.ts` | `DocRegistry` unchanged (runtime only, not storage). |
| `lifecycle/manager.ts` | Use storage backend for CRUD, not direct `fs`. |
| `skill/ingest.ts` | Create docs via storage backend. Ingest creates blobs (Phase 2). |
| `index.ts` | Export storage types and FsStorageBackend. |

### Key Refactor: Workspace Constructor

```typescript
// Before
static async create(dir: string): Promise<Workspace>

// After
static async create(storage: StorageBackend): Promise<Workspace>
```

Internally, `Workspace.scan()` becomes:
```typescript
private async scan(): Promise<void> {
  const docs = await this.storage.listDocs();
  for (const doc of docs) {
    const source = await this.storage.getDoc(doc.id);
    if (!source) continue;
    const codoc = parseCodoc(source);
    this.parsed.set(doc.id, codoc);
    this.index.set(doc.id, this.extractMeta(doc.id, codoc));
  }
}
```

---

## `apps/cobook` — Chat Persistence + Multi-Chat + Blob Upload

### New Files

```
apps/cobook/src/
├── workspace/server/
│   ├── chat-manager.ts        ← Multi-chat lifecycle (create, load, switch, save)
│   └── blob-api.ts            ← Blob upload/download handlers
├── workspace/stores/
│   └── chat-store.ts          ← Client-side chat list state (refactor from session hooks)
├── workspace/components/
│   └── chat/
│       └── ChatList.tsx        ← Chat list sidebar component
├── app/api/
│   ├── chats/
│   │   ├── route.ts           ← GET list, POST create
│   │   └── [id]/route.ts      ← GET detail, DELETE
│   └── blobs/
│       └── route.ts           ← POST upload, GET download
```

### Modified Files

| File | Change |
|------|--------|
| `workspace/server/workspace.ts` | Create `FsStorageBackend`, pass to `Workspace.create()`. |
| `workspace/server/chat.ts` | From singleton `ChatAbility` to `ChatManager` (per-chat instances). |
| `workspace/hooks/use-session.ts` | Add chat list hooks, chat switching. |
| `workspace/hooks/use-workspace.ts` | No major change (SSE still project-wide). |
| `workspace/components/WorkspaceShell.tsx` | Add chat list to sidebar. Chat switching state. |
| `workspace/components/chat/ChatArea.tsx` | Receive chat ID prop, load correct chat. |
| `workspace/stores/api-client.ts` | Add chat list API calls, blob upload call. |
| `agents/register.ts` | Agent system init per chat (not global singleton). |
| `app/api/docs/route.ts` | Use doc ID instead of filename. |
| `app/api/docs/[docId]/route.ts` | Resolve by ID or slug. |
| `app/api/workspace/route.ts` | Include project metadata in response. |

### Key Refactor: Chat Manager

```typescript
// Before (singleton)
const ability = getChatAbility();

// After (per-chat)
const manager = getChatManager();
const chat = await manager.getOrCreate(chatId);
```

`ChatManager` wraps `StorageBackend` chat methods and maintains a cache of loaded `ChatAbility` instances.

---

## API Route Changes

### New Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/chats` | List chats |
| POST | `/api/chats` | Create new chat |
| GET | `/api/chats/{id}` | Get chat detail (messages + refs) |
| DELETE | `/api/chats/{id}` | Delete chat |
| POST | `/api/blobs` | Upload blob |
| GET | `/api/blobs/{id}` | Download blob |

### Modified Routes

| Path | Change |
|------|--------|
| `/api/chat/route.ts` | Add `chatId` parameter to all endpoints |
| `/api/chat/intent/route.ts` | Add `chatId` parameter |
| `/api/chat/reference/route.ts` | Add `chatId` parameter |
| `/api/docs/route.ts` | Return `DocRecord` (with id + slug) |
| `/api/docs/[docId]/route.ts` | Accept ID or slug as parameter |

---

## What Gets Deleted

| File/Code | Reason |
|-----------|--------|
| Direct `fs` imports in `workspace-api.ts` | Replaced by StorageBackend |
| `globalThis._ws` singleton pattern | Replaced by proper DI through StorageBackend |
| `getDocRegistry()` module-level singleton | Registry owned by Workspace instance |
| `setDocRegistry()` | Same — no more module-level state |

---

## Testing Strategy

### Unit Tests

- `FsStorageBackend`: CRUD operations on temp directory
- `Workspace` with mock `StorageBackend`: verify all operations go through interface
- `PersistentChat`: verify debounced save behavior
- Migration: verify old layout → new layout conversion

### Integration Tests

- Full flow: create project → create codoc → load doc → force fields → verify snapshot saved
- Chat flow: create chat → send message → reload chat → verify messages persisted
- Blob flow: upload blob → create codoc with blob connector → verify data loads

### Existing Tests

All existing tests in `@codoc/core`, `@codoc/graph`, `@codoc/source` should pass without modification.
Tests in `@cobook/workspace` need updates only where they directly instantiate `Workspace.create(dir)`.
