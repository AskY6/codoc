export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  content: string;
  references: string[];
  agentId?: string;
  previews?: WritePreview[];
  quotedIds?: string[];
  ts: number;
}

export interface WritePreview {
  targetDocId: string;
  targetField: string;
  value: unknown;
  confirmed: boolean;
}

type Listener = () => void;

let nextId = 1;

export class ChatStore {
  private messages: ChatMessage[] = [];
  private activeLeaf: string | null = null;
  private listeners = new Set<Listener>();
  private branchCache: ChatMessage[] = [];
  private branchDirty = true;

  getActiveBranch(): ChatMessage[] {
    if (!this.branchDirty) return this.branchCache;
    if (!this.activeLeaf) {
      this.branchCache = [];
      this.branchDirty = false;
      return this.branchCache;
    }

    const byId = new Map(this.messages.map((m) => [m.id, m]));
    const chain: ChatMessage[] = [];
    let cur: string | null = this.activeLeaf;
    while (cur) {
      const msg = byId.get(cur);
      if (!msg) break;
      chain.unshift(msg);
      cur = msg.parentId;
    }
    this.branchCache = chain;
    this.branchDirty = false;
    return this.branchCache;
  }

  getMessageById(id: string): ChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  addMessage(
    role: "user" | "assistant",
    content: string,
    references: string[],
    agentId?: string,
    quotedIds?: string[],
  ): ChatMessage {
    const msg: ChatMessage = {
      id: String(nextId++),
      parentId: this.activeLeaf,
      role,
      content,
      references,
      agentId,
      quotedIds: quotedIds?.length ? quotedIds : undefined,
      ts: Date.now(),
    };
    this.messages = [...this.messages, msg];
    this.activeLeaf = msg.id;
    this.branchDirty = true;
    this.notify();
    return msg;
  }

  updateMessageContent(id: string, content: string): void {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, content } : m,
    );
    this.branchDirty = true;
    this.notify();
  }

  setPreview(messageId: string, preview: WritePreview): void {
    this.messages = this.messages.map((m) =>
      m.id === messageId
        ? { ...m, previews: [...(m.previews ?? []), preview] }
        : m,
    );
    this.branchDirty = true;
    this.notify();
  }

  confirmPreview(messageId: string, index: number): void {
    this.messages = this.messages.map((m) => {
      if (m.id !== messageId || !m.previews?.[index]) return m;
      const previews = m.previews.map((p, i) =>
        i === index ? { ...p, confirmed: true } : p,
      );
      return { ...m, previews };
    });
    this.branchDirty = true;
    this.notify();
  }

  clear(): void {
    this.messages = [];
    this.activeLeaf = null;
    this.branchDirty = true;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
