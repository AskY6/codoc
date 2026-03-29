import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChatAbility } from "../../chat/index.js";
import type { Message, NewMessage } from "../../chat/types.js";

const mockCreate = vi.fn();
vi.mock("../../shared/ai.js", () => ({
  getClient: () => ({ messages: { create: mockCreate } }),
  getModel: () => "test-model",
}));

// Import after mock setup
const { codocAgentParticipant } = await import("../codoc-agent.js");
const { summaryAgentParticipant } = await import("../summary-agent.js");
const { infoCheckAgentParticipant } = await import("../info-check-agent.js");
const { polishAgentParticipant } = await import("../polish-agent.js");
const { createCodocAgentHandler } = await import("../codoc-agent.js");
const { createSummaryAgentHandler } = await import("../summary-agent.js");
const { createInfoCheckAgentHandler } = await import("../info-check-agent.js");
const { createPolishAgentHandler } = await import("../polish-agent.js");
const {
  presetAgents,
  registerPresetAgents,
  registerPresetAgentHandlers,
} = await import("../register.js");
const {
  parseIntentBlocks,
  stripIntentBlocks,
  formatContextForPrompt,
} = await import("../types.js");

function llmResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

function userMsg(content: string, extras?: Partial<NewMessage>): NewMessage {
  return {
    sender: { id: "user-1", kind: "human" },
    content,
    ...extras,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

// --- Participant definitions ---

describe("Participant definitions", () => {
  it("codoc-agent is a daemon with resource filter", () => {
    expect(codocAgentParticipant.id).toBe("codoc-agent");
    expect(codocAgentParticipant.kind).toBe("agent");
    expect(codocAgentParticipant.responseMode.type).toBe("daemon");
    const mode = codocAgentParticipant.responseMode;
    if (mode.type === "daemon") {
      expect(mode.filter.resourceKinds).toContain("codoc");
    }
    expect(codocAgentParticipant.contextRequirements).toEqual([
      { sourceKind: "codoc-snapshot", priority: "required" },
      { sourceKind: "chat-history", priority: "optional", maxTokens: 1000 },
    ]);
  });

  it("summary-agent is on-mention with chat-history required", () => {
    expect(summaryAgentParticipant.id).toBe("summary-agent");
    expect(summaryAgentParticipant.responseMode.type).toBe("on-mention");
    expect(summaryAgentParticipant.contextRequirements).toEqual([
      { sourceKind: "chat-history", priority: "required" },
      { sourceKind: "quoted-messages", priority: "optional" },
      { sourceKind: "codoc-snapshot", priority: "optional" },
    ]);
  });

  it("info-check-agent is on-mention with codoc-snapshot required", () => {
    expect(infoCheckAgentParticipant.id).toBe("info-check-agent");
    expect(infoCheckAgentParticipant.responseMode.type).toBe("on-mention");
    expect(infoCheckAgentParticipant.contextRequirements?.[0]).toEqual({
      sourceKind: "codoc-snapshot",
      priority: "required",
    });
  });

  it("polish-agent is on-mention with codoc-snapshot required only", () => {
    expect(polishAgentParticipant.id).toBe("polish-agent");
    expect(polishAgentParticipant.responseMode.type).toBe("on-mention");
    expect(polishAgentParticipant.contextRequirements).toEqual([
      { sourceKind: "codoc-snapshot", priority: "required" },
    ]);
  });

  it("presetAgents contains all 4 agents", () => {
    expect(presetAgents).toHaveLength(4);
    const ids = presetAgents.map((a) => a.id);
    expect(ids).toContain("codoc-agent");
    expect(ids).toContain("summary-agent");
    expect(ids).toContain("info-check-agent");
    expect(ids).toContain("polish-agent");
  });
});

// --- Intent parsing ---

describe("parseIntentBlocks", () => {
  it("parses a single intent block", () => {
    const text = `Here is my response.\n<intent>\n{"kind": "write-codoc-field", "payload": {"docId": "a.codoc", "field": "/title", "value": "New"}}\n</intent>`;
    const intents = parseIntentBlocks(text);
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe("write-codoc-field");
    expect(intents[0].payload).toEqual({
      docId: "a.codoc",
      field: "/title",
      value: "New",
    });
    expect(intents[0].status).toBe("proposed");
  });

  it("parses multiple intent blocks", () => {
    const text = `Polishing two fields.\n<intent>\n{"kind": "write-codoc-field", "payload": {"docId": "a.codoc", "field": "/title", "value": "T1"}}\n</intent>\nAnd also:\n<intent>\n{"kind": "write-codoc-field", "payload": {"docId": "a.codoc", "field": "/body", "value": "B1"}}\n</intent>`;
    const intents = parseIntentBlocks(text);
    expect(intents).toHaveLength(2);
  });

  it("skips malformed JSON in intent blocks", () => {
    const text = `<intent>\nnot json\n</intent>\n<intent>\n{"kind": "write-codoc-field", "payload": {}}\n</intent>`;
    const intents = parseIntentBlocks(text);
    expect(intents).toHaveLength(1);
  });

  it("returns empty array when no intent blocks", () => {
    expect(parseIntentBlocks("just plain text")).toEqual([]);
  });
});

describe("stripIntentBlocks", () => {
  it("removes intent blocks and trims", () => {
    const text = `Response here.\n<intent>\n{"kind": "x", "payload": {}}\n</intent>\nMore text.`;
    const stripped = stripIntentBlocks(text);
    expect(stripped).toBe("Response here.\n\nMore text.");
    expect(stripped).not.toContain("<intent>");
  });

  it("returns original text when no intent blocks", () => {
    expect(stripIntentBlocks("hello")).toBe("hello");
  });
});

describe("formatContextForPrompt", () => {
  it("formats context data with kind headers", () => {
    const result = formatContextForPrompt([
      { kind: "chat-history", content: "msg1\nmsg2" },
      { kind: "codoc-snapshot", content: "## doc" },
    ]);
    expect(result).toContain("[chat-history]");
    expect(result).toContain("msg1\nmsg2");
    expect(result).toContain("[codoc-snapshot]");
    expect(result).toContain("## doc");
  });

  it("returns empty string for empty context", () => {
    expect(formatContextForPrompt([])).toBe("");
  });
});

// --- Handler execution ---

describe("Agent handlers", () => {
  it("codoc-agent handler calls LLM and returns reply", async () => {
    mockCreate.mockResolvedValue(
      llmResponse("I'll update the title.\n<intent>\n{\"kind\": \"write-codoc-field\", \"payload\": {\"docId\": \"a.codoc\", \"field\": \"/title\", \"value\": \"New\"}}\n</intent>"),
    );

    const handler = createCodocAgentHandler();
    const result = await handler(
      [{ kind: "codoc-snapshot", content: "## a.codoc\n- /title: Old" }],
      {
        id: "m1",
        sender: { id: "user-1", kind: "human" },
        content: "update the title to New",
        timestamp: 1,
      },
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe("reply");
    if (result!.type === "reply") {
      expect(result!.message.sender.id).toBe("codoc-agent");
      expect(result!.message.content).toBe("I'll update the title.");
      expect(result!.message.intents).toHaveLength(1);
      expect(result!.message.intents![0].kind).toBe("write-codoc-field");
      expect(result!.message.intents![0].status).toBe("proposed");
    }
  });

  it("summary-agent handler returns reply without intents for plain summary", async () => {
    mockCreate.mockResolvedValue(
      llmResponse("Here is the summary:\n1. Point A\n2. Point B"),
    );

    const handler = createSummaryAgentHandler();
    const result = await handler(
      [{ kind: "chat-history", content: "user said X, agent said Y" }],
      {
        id: "m2",
        sender: { id: "user-1", kind: "human" },
        content: "summarize",
        timestamp: 1,
      },
    );

    expect(result).not.toBeNull();
    if (result!.type === "reply") {
      expect(result!.message.sender.id).toBe("summary-agent");
      expect(result!.message.content).toContain("Point A");
      expect(result!.message.intents).toBeUndefined();
    }
  });

  it("info-check-agent handler produces validation report with intents", async () => {
    mockCreate.mockResolvedValue(
      llmResponse("Found inconsistency in /name.\n<intent>\n{\"kind\": \"write-codoc-field\", \"payload\": {\"docId\": \"b.codoc\", \"field\": \"/name\", \"value\": \"Fixed\"}}\n</intent>"),
    );

    const handler = createInfoCheckAgentHandler();
    const result = await handler(
      [{ kind: "codoc-snapshot", content: "## b.codoc\n- /name: Wrong" }],
      {
        id: "m3",
        sender: { id: "user-1", kind: "human" },
        content: "check this codoc",
        timestamp: 1,
      },
    );

    expect(result).not.toBeNull();
    if (result!.type === "reply") {
      expect(result!.message.sender.id).toBe("info-check-agent");
      expect(result!.message.content).toContain("inconsistency");
      expect(result!.message.intents).toHaveLength(1);
    }
  });

  it("polish-agent handler produces per-field intents", async () => {
    mockCreate.mockResolvedValue(
      llmResponse("Polished /desc.\n<intent>\n{\"kind\": \"write-codoc-field\", \"payload\": {\"docId\": \"c.codoc\", \"field\": \"/desc\", \"value\": \"Polished text\"}}\n</intent>"),
    );

    const handler = createPolishAgentHandler();
    const result = await handler(
      [{ kind: "codoc-snapshot", content: "## c.codoc\n- /desc: rough text" }],
      {
        id: "m4",
        sender: { id: "user-1", kind: "human" },
        content: "polish this",
        timestamp: 1,
      },
    );

    expect(result).not.toBeNull();
    if (result!.type === "reply") {
      expect(result!.message.sender.id).toBe("polish-agent");
      expect(result!.message.intents).toHaveLength(1);
      expect(result!.message.intents![0].payload).toEqual({
        docId: "c.codoc",
        field: "/desc",
        value: "Polished text",
      });
    }
  });

  it("handler returns null when LLM produces empty response", async () => {
    mockCreate.mockResolvedValue({ content: [] });

    const handler = createCodocAgentHandler();
    const result = await handler([], {
      id: "m5",
      sender: { id: "user-1", kind: "human" },
      content: "hi",
      timestamp: 1,
    });

    expect(result).toBeNull();
  });

  it("handler passes context and message to LLM", async () => {
    mockCreate.mockResolvedValue(llmResponse("ok"));

    const handler = createSummaryAgentHandler();
    await handler(
      [{ kind: "chat-history", content: "history data" }],
      {
        id: "m6",
        sender: { id: "user-1", kind: "human" },
        content: "summarize please",
        timestamp: 1,
      },
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("test-model");
    expect(callArgs.messages[0].content).toContain("[chat-history]");
    expect(callArgs.messages[0].content).toContain("history data");
    expect(callArgs.messages[0].content).toContain("summarize please");
  });

  it("handler includes intent and resource info from trigger message", async () => {
    mockCreate.mockResolvedValue(llmResponse("noted"));

    const handler = createCodocAgentHandler();
    await handler([], {
      id: "m7",
      sender: { id: "summary-agent", kind: "agent" },
      content: "writing summary",
      intents: [
        { kind: "write-codoc-field", payload: { docId: "x.codoc", field: "/summary", value: "S" }, status: "proposed" },
      ],
      resourceRefs: [{ kind: "codoc", id: "x.codoc", label: "My Doc" }],
      timestamp: 1,
    });

    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain("write-codoc-field");
    expect(userContent).toContain("x.codoc");
    expect(userContent).toContain("My Doc");
  });
});

// --- Registration ---

describe("registerPresetAgents", () => {
  it("registers all 4 participants in a session", () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "reg-test" });

    registerPresetAgents(chat, sid);

    const participants = chat.getParticipants(sid);
    expect(participants).toHaveLength(4);
    expect(participants.map((p) => p.id)).toEqual([
      "codoc-agent",
      "summary-agent",
      "info-check-agent",
      "polish-agent",
    ]);
  });

  it("throws if registered twice", () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "dup-test" });

    registerPresetAgents(chat, sid);
    expect(() => registerPresetAgents(chat, sid)).toThrow(
      "Participant already registered",
    );
  });
});

describe("registerPresetAgentHandlers", () => {
  it("registers handlers for all 4 agents", () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "handler-test" });
    registerPresetAgents(chat, sid);
    registerPresetAgentHandlers(chat, sid);

    // Verify by sending a mention — handler should be called
    mockCreate.mockResolvedValue(llmResponse("response"));

    chat.sendMessage(sid, userMsg("test", {
      mentionedParticipants: ["summary-agent"],
    }));

    // mockCreate being called confirms the handler was registered and invoked
    // (async, so we wait)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockCreate).toHaveBeenCalled();
        resolve();
      }, 50);
    });
  });
});

// --- Integration: routing triggers agent ---

describe("Agent routing integration", () => {
  it("@mention triggers on-mention agent and produces reply", async () => {
    mockCreate.mockResolvedValue(llmResponse("Here is the summary."));

    const chat = createChatAbility();
    const sid = chat.createSession({ id: "int-1" });
    registerPresetAgents(chat, sid);
    registerPresetAgentHandlers(chat, sid);

    chat.registerContextSource(sid, {
      kind: "chat-history",
      resolve: async () => ({
        kind: "chat-history",
        content: "previous messages",
        tokens: 20,
      }),
    });

    chat.sendMessage(sid, userMsg("summarize this", {
      mentionedParticipants: ["summary-agent"],
    }));

    await new Promise((r) => setTimeout(r, 100));

    const messages = chat.getMessages(sid);
    expect(messages).toHaveLength(2);
    expect(messages[1].sender.id).toBe("summary-agent");
    expect(messages[1].content).toBe("Here is the summary.");
  });

  it("daemon codoc-agent triggers on codoc resource ref", async () => {
    mockCreate.mockResolvedValue(llmResponse("I see a codoc document."));

    const chat = createChatAbility();
    const sid = chat.createSession({ id: "int-2" });
    registerPresetAgents(chat, sid);
    registerPresetAgentHandlers(chat, sid);

    chat.sendMessage(sid, userMsg("check this", {
      resourceRefs: [{ kind: "codoc", id: "doc-1" }],
    }));

    await new Promise((r) => setTimeout(r, 100));

    const messages = chat.getMessages(sid);
    expect(messages).toHaveLength(2);
    expect(messages[1].sender.id).toBe("codoc-agent");
  });

  it("daemon codoc-agent triggers on message with codoc ref + intent", async () => {
    mockCreate.mockResolvedValue(llmResponse("Acknowledged the write."));

    const chat = createChatAbility();
    const sid = chat.createSession({ id: "int-3" });
    registerPresetAgents(chat, sid);
    registerPresetAgentHandlers(chat, sid);

    // In practice, agent messages with codoc intents also carry resource refs
    chat.sendMessage(sid, {
      sender: { id: "summary-agent", kind: "agent" },
      content: "Saving summary",
      resourceRefs: [{ kind: "codoc", id: "d.codoc" }],
      intents: [
        {
          kind: "write-codoc-field",
          payload: { docId: "d.codoc", field: "/summary", value: "S" },
          status: "proposed",
        },
      ],
    });

    await new Promise((r) => setTimeout(r, 100));

    const messages = chat.getMessages(sid);
    expect(messages).toHaveLength(2);
    expect(messages[1].sender.id).toBe("codoc-agent");
  });

  it("on-mention agents are NOT triggered without mention", async () => {
    mockCreate.mockResolvedValue(llmResponse("should not appear"));

    const chat = createChatAbility();
    const sid = chat.createSession({ id: "int-4" });
    registerPresetAgents(chat, sid);
    registerPresetAgentHandlers(chat, sid);

    // Plain message with no mentions, no codoc refs, no intents
    chat.sendMessage(sid, userMsg("just chatting"));

    await new Promise((r) => setTimeout(r, 100));

    const messages = chat.getMessages(sid);
    expect(messages).toHaveLength(1); // Only the user message
  });
});
