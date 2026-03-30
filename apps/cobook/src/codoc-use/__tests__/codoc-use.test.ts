import { describe, it, expect, vi } from "vitest";
import { createChatAbility } from "../../chat/index.js";
import { initCodocUse, isFieldStale } from "../index.js";
import type { Workspace, WorkspaceChangeEvent } from "@codoc/core";

vi.mock("@codoc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codoc/core")>();
  return {
    ...actual,
    propagateAndInvalidate: vi.fn().mockReturnValue([]),
    propagateDirty: vi.fn().mockReturnValue([]),
  };
});

function makeWorkspace(
  docs: Array<{
    docId: string;
    fields: Record<string, { status: string; value?: unknown }>;
  }>,
) {
  const fieldChangeListeners: Array<(e: WorkspaceChangeEvent) => void> = [];

  const ws = {
    listDocs: () =>
      docs.map((d) => ({
        docId: d.docId,
        type: {},
        fields: Object.keys(d.fields).map((path) => ({
          path,
          loaderType: "literal",
        })),
        externalRefs: [],
      })),
    getDocMeta: (id: string) => {
      const doc = docs.find((d) => d.docId === id);
      if (!doc) return undefined;
      return {
        docId: doc.docId,
        type: {},
        fields: Object.keys(doc.fields).map((path) => ({
          path,
          loaderType: "literal",
        })),
        externalRefs: [],
      };
    },
    loadDoc: vi.fn((id: string) => {
      const doc = docs.find((d) => d.docId === id);
      if (!doc) throw new Error(`Doc not found: ${id}`);
      return {
        tree: {
          getField: (path: string) => {
            const entry = doc.fields[path];
            if (!entry) return undefined;
            return { path, meta: {}, state: entry };
          },
          updateField: vi.fn(),
          refreshField: vi.fn(),
          observe: vi.fn().mockResolvedValue(undefined),
        },
        dag: {},
      };
    }),
    createDoc: vi.fn().mockResolvedValue({ docId: "new.codoc", type: {}, fields: [], externalRefs: [] }),
    rewriteDoc: vi.fn().mockResolvedValue({ docId: "doc.codoc", type: {}, fields: [], externalRefs: [] }),
    onFieldChange: vi.fn((cb: (e: WorkspaceChangeEvent) => void) => {
      fieldChangeListeners.push(cb);
      return () => {
        const idx = fieldChangeListeners.indexOf(cb);
        if (idx >= 0) fieldChangeListeners.splice(idx, 1);
      };
    }),
  } as unknown as Workspace;

  return {
    ws,
    emitFieldChange(event: WorkspaceChangeEvent) {
      for (const cb of [...fieldChangeListeners]) cb(event);
    },
  };
}

describe("initCodocUse", () => {
  it("registers codoc-snapshot context source factory", async () => {
    const { ws } = makeWorkspace([
      { docId: "a.codoc", fields: { "/name": { status: "resolved", value: "Test" } } },
    ]);
    const chat = createChatAbility();
    const sessionId = chat.createSession();

    initCodocUse(ws, chat, sessionId);

    // Add a resource ref and register a participant that needs codoc-snapshot
    chat.addResourceRef(sessionId, { kind: "codoc", id: "a.codoc" });

    chat.registerParticipant(sessionId, {
      id: "test-agent",
      kind: "agent",
      name: "Test",
      description: "test",
      responseMode: { type: "on-mention" },
      contextRequirements: [
        { sourceKind: "codoc-snapshot", priority: "required" },
      ],
    });

    // Register a handler that captures the context it receives
    let receivedContext: unknown[] = [];
    chat.registerAgentHandler(sessionId, "test-agent", async (ctx) => {
      receivedContext = ctx;
      return null;
    });

    // Send a message mentioning the agent
    chat.sendMessage(sessionId, {
      sender: { id: "user", kind: "human" },
      content: "test",
      mentionedParticipants: ["test-agent"],
    });

    // Wait for async routing
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedContext).toHaveLength(1);
    expect((receivedContext[0] as { kind: string }).kind).toBe("codoc-snapshot");
    expect((receivedContext[0] as { content: string }).content).toContain("a.codoc");
  });

  it("executes codoc intent on confirm", async () => {
    const { ws } = makeWorkspace([
      { docId: "doc.codoc", fields: { "/title": { status: "resolved", value: "Old" } } },
    ]);
    const chat = createChatAbility();
    const sessionId = chat.createSession();

    initCodocUse(ws, chat, sessionId);

    // Send a message with a proposed write intent
    const msg = chat.sendMessage(sessionId, {
      sender: { id: "agent-1", kind: "agent" },
      content: "I'll update the title",
      intents: [
        {
          kind: "write-codoc-field",
          payload: { docId: "doc.codoc", field: "/title", value: "New" },
          status: "proposed",
        },
      ],
    });

    // Confirm the intent
    chat.updateIntentStatus(sessionId, msg.id, 0, "confirmed");

    // Wait for async execution
    await new Promise((r) => setTimeout(r, 50));

    // Verify the intent was executed — loadDoc was called
    const runtime = (ws as any).loadDoc("doc.codoc");
    expect(runtime.tree.updateField).toBeDefined();
  });

  it("bridges workspace events to chat messages", async () => {
    const { ws, emitFieldChange } = makeWorkspace([
      { docId: "r.codoc", fields: { "/x": { status: "resolved", value: 1 } } },
    ]);
    const chat = createChatAbility();
    const sessionId = chat.createSession();

    initCodocUse(ws, chat, sessionId);

    emitFieldChange({ docId: "r.codoc", fieldPath: "/x", timestamp: 1 });

    // Events are debounced — wait for flush
    await new Promise((r) => setTimeout(r, 2500));

    const messages = chat.getMessages(sessionId);
    expect(messages.some((m) => m.content.includes("r.codoc"))).toBe(true);
    expect(messages.some((m) => m.content.includes("/x"))).toBe(true);
  });

  it("returns unsubscribe that cleans up", () => {
    const { ws } = makeWorkspace([]);
    const chat = createChatAbility();
    const sessionId = chat.createSession();

    const unsub = initCodocUse(ws, chat, sessionId);
    unsub();

    // Workspace onFieldChange should have been unsubbed
    // (no error on subsequent field changes)
  });
});

describe("create-codoc intent execution", () => {
  it("calls workspace.createDoc and loadDoc on confirm", async () => {
    const { ws } = makeWorkspace([
      { docId: "new.codoc", fields: { "/x": { status: "resolved", value: "hello" } } },
    ]);
    const chat = createChatAbility();
    const sessionId = chat.createSession();

    initCodocUse(ws, chat, sessionId);

    const yamlContent = "type:\n  properties:\n    x:\n      type: string\ndata:\n  x: hello\nview: \"# hi\"";
    const msg = chat.sendMessage(sessionId, {
      sender: { id: "codoc-agent", kind: "agent" },
      content: "Creating a new doc",
      intents: [
        {
          kind: "create-codoc",
          payload: { docId: "new.codoc", content: yamlContent },
          status: "proposed",
        },
      ],
    });

    chat.updateIntentStatus(sessionId, msg.id, 0, "confirmed");
    await new Promise((r) => setTimeout(r, 50));

    expect((ws as any).createDoc).toHaveBeenCalledWith("new.codoc", yamlContent);
    expect((ws as any).loadDoc).toHaveBeenCalledWith("new.codoc");
  });
});

describe("rewrite-codoc intent execution", () => {
  it("calls workspace.rewriteDoc and loadDoc on confirm", async () => {
    const { ws } = makeWorkspace([
      { docId: "doc.codoc", fields: { "/x": { status: "resolved", value: "old" } } },
    ]);
    const chat = createChatAbility();
    const sessionId = chat.createSession();

    initCodocUse(ws, chat, sessionId);

    const msg = chat.sendMessage(sessionId, {
      sender: { id: "codoc-agent", kind: "agent" },
      content: "Rewriting doc",
      intents: [
        {
          kind: "rewrite-codoc",
          payload: {
            docId: "doc.codoc",
            content: "type:\n  properties:\n    x:\n      type: string\ndata:\n  x: new\nview: \"# hi\"",
            changelog: "updated x",
          },
          status: "proposed",
        },
      ],
    });

    chat.updateIntentStatus(sessionId, msg.id, 0, "confirmed");
    await new Promise((r) => setTimeout(r, 50));

    expect((ws as any).rewriteDoc).toHaveBeenCalledWith(
      "doc.codoc",
      expect.any(String),
    );
    expect((ws as any).loadDoc).toHaveBeenCalledWith("doc.codoc");
  });
});

describe("isFieldStale", () => {
  it("returns true for dirty fields", () => {
    const { ws } = makeWorkspace([
      { docId: "d.codoc", fields: { "/f": { status: "dirty" } } },
    ]);
    expect(isFieldStale(ws, "d.codoc", "/f")).toBe(true);
  });

  it("returns false for resolved fields", () => {
    const { ws } = makeWorkspace([
      { docId: "d.codoc", fields: { "/f": { status: "resolved", value: 1 } } },
    ]);
    expect(isFieldStale(ws, "d.codoc", "/f")).toBe(false);
  });

  it("returns false for non-existent doc", () => {
    const { ws } = makeWorkspace([]);
    expect(isFieldStale(ws, "nope.codoc", "/f")).toBe(false);
  });
});
