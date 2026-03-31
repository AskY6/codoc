# Chat Persistence & Multi-Session Design

---

## Current State

- Single `ChatAbility` instance created at server startup
- Messages stored in-memory (`MessageTree`)
- References stored in-memory (session-scoped)
- No persistence — refresh or restart loses everything
- No chat list — only one active conversation

---

## Target State

- Multiple chat sessions per project
- Each chat persisted to `StorageBackend`
- Chat list UI with create/switch/delete
- Chat ↔ Codoc references persisted per chat
- Agent handlers re-attached on chat load

---

## Data Model

### ChatRecord

```typescript
interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  references: ResourceRef[];
  activeBranch: string[];       // Active path in the message tree
}

interface ChatMessage {
  id: string;
  parentId: string | null;
  participantId: string;
  content: string;
  intents: Intent[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface ResourceRef {
  kind: string;        // "codoc"
  id: string;          // doc ID
  label: string;       // display name
}
```

### Intent Persistence

Intents are stored as part of the message they belong to:

```typescript
interface Intent {
  id: string;
  kind: string;                           // "create-codoc", "rewrite-codoc", etc.
  status: "proposed" | "confirmed" | "rejected" | "executed" | "failed";
  payload: Record<string, unknown>;
  result?: unknown;                       // Execution result (if executed)
}
```

This means the full history of what agents proposed and what users confirmed/rejected is preserved.

---

## Persistence Strategy

### When to Save

Chat state is saved on every mutation:
- New message added
- Intent status changed (confirmed/rejected/executed)
- Reference added/removed
- Title changed

### How to Save

**Debounced write**: mutations within 500ms are batched into a single write. This prevents thrashing on rapid intent confirmations.

```typescript
class PersistentChat {
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  private scheduleSave(): void {
    this.dirty = true;
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.dirty) {
          this.flush();
          this.dirty = false;
        }
      }, 500);
    }
  }

  private async flush(): Promise<void> {
    const record = this.serialize();
    await this.storage.updateChat(this.id, record);
  }
}
```

### Loading a Chat

When the user switches to a chat:
1. Read `ChatRecord` from storage
2. Reconstruct `MessageTree` from `messages` array
3. Re-attach agent handlers (agents are stateless — they re-evaluate context on each message)
4. Restore `references` to the chat session
5. Resume SSE event stream for this chat

---

## Chat List UI

### Left Sidebar Change

Current sidebar: Resources (codoc list) only.

New sidebar structure:
```
┌─────────────────────┐
│  Resources           │  ← Codoc list (existing)
│  ├── api-dashboard   │
│  ├── session-aaa     │
│  └── session-bbb     │
│                      │
│  ─────────────────── │
│                      │
│  Chats               │  ← NEW: chat list
│  ├── + New chat      │
│  ├── API setup (now) │
│  ├── Log analysis    │
│  └── 3 more...       │
└─────────────────────┘
```

Or: chats and resources as two tabs in the sidebar. The exact UI is a design detail, not an architecture decision.

### Chat Switching

When switching chats:
1. Save current chat state (if dirty)
2. Load target chat from storage
3. Update center panel to show target chat's messages
4. Update reference bar to show target chat's codoc references
5. SSE events continue for all chats (field changes are project-wide, not chat-scoped)

---

## Agent Re-attachment

Agents are stateless. They don't have persistent memory across chat switches. When a chat is loaded:

1. The `NLRouter` and `SceneAgentRegistry` are project-level singletons — always available
2. The `ChatAbility` instance is created per chat session
3. `registerParticipant()` and `registerAgentHandler()` are called on load
4. Agent handlers reference the same Workspace instance (project-level)

This means: switching chats doesn't lose agent capabilities. The agent just sees a different conversation history and different referenced codocs.

---

## SSE Events

### Current: Single Stream

One SSE endpoint (`/api/events`) streams all field changes and chat events.

### New: Scoped Streams

Field changes are project-wide (a codoc update affects all viewers). Chat events are per-chat.

Option A: Keep single stream, client filters by chat ID.
Option B: Parameterize stream: `/api/events?chatId={id}`.

**Recommendation: Option A** (simpler). The event volume is low enough that client-side filtering is fine. Field events don't have a chat scope anyway.

---

## Auto-Persistence for Current Single-Chat Users

For users who don't explicitly manage chats, the system behaves naturally:

1. On first visit, a default chat is created automatically
2. All messages go to this single chat
3. If the user never creates a second chat, the experience is identical to today — but now it persists

No migration of existing in-memory chat state is needed (there's nothing to migrate — current state is lost on refresh anyway).
