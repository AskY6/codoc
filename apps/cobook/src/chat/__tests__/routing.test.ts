import { describe, it, expect, vi } from "vitest";
import { createChatAbility } from "../index.js";
import type { NewMessage, Participant } from "../types.js";

const human: Participant = {
  id: "user-1",
  kind: "human",
  name: "User",
  description: "",
  responseMode: { type: "on-mention" },
};

const echoAgent: Participant = {
  id: "echo-agent",
  kind: "agent",
  name: "Echo",
  description: "Echoes messages back",
  responseMode: { type: "on-mention" },
};

const daemonAgent: Participant = {
  id: "daemon-agent",
  kind: "agent",
  name: "Daemon",
  description: "Watches for codoc resources",
  responseMode: {
    type: "daemon",
    filter: { resourceKinds: ["codoc"] },
  },
};

function userMsg(content: string, extras?: Partial<NewMessage>): NewMessage {
  return {
    sender: { id: "user-1", kind: "human" },
    content,
    ...extras,
  };
}

describe("ChatAbility routing integration", () => {
  it("routes @mention to the correct agent handler", async () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    chat.registerParticipant(sid, human);
    chat.registerParticipant(sid, echoAgent);

    const handler = vi.fn().mockResolvedValue({
      type: "reply",
      message: {
        sender: { id: "echo-agent", kind: "agent" },
        content: "echo: hello",
      },
    });
    chat.registerAgentHandler(sid, "echo-agent", handler);

    chat.sendMessage(sid, userMsg("hello", {
      mentionedParticipants: ["echo-agent"],
    }));

    // Wait for async routing
    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
    const messages = chat.getMessages(sid);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("echo: hello");
    expect(messages[1].sender.id).toBe("echo-agent");
  });

  it("routes daemon agent based on resource filter", async () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    chat.registerParticipant(sid, human);
    chat.registerParticipant(sid, daemonAgent);

    const handler = vi.fn().mockResolvedValue({
      type: "reply",
      message: {
        sender: { id: "daemon-agent", kind: "agent" },
        content: "I see a codoc",
      },
    });
    chat.registerAgentHandler(sid, "daemon-agent", handler);

    chat.sendMessage(sid, userMsg("check this", {
      resourceRefs: [{ kind: "codoc", id: "doc-1" }],
    }));

    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
    const messages = chat.getMessages(sid);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("I see a codoc");
  });

  it("does not trigger agent when filter does not match", async () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    chat.registerParticipant(sid, human);
    chat.registerParticipant(sid, daemonAgent);

    const handler = vi.fn().mockResolvedValue(null);
    chat.registerAgentHandler(sid, "daemon-agent", handler);

    // No codoc resource → daemon should not trigger
    chat.sendMessage(sid, userMsg("just chatting"));

    await new Promise((r) => setTimeout(r, 50));

    expect(handler).not.toHaveBeenCalled();
  });

  it("agent handler receives assembled context", async () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    chat.registerParticipant(sid, {
      ...echoAgent,
      contextRequirements: [
        { sourceKind: "chat-history", priority: "required" },
      ],
    });

    chat.registerContextSource(sid, {
      kind: "chat-history",
      resolve: async () => ({
        kind: "chat-history",
        content: "previous messages here",
        tokens: 20,
      }),
    });

    let receivedContext: any = null;
    chat.registerAgentHandler(sid, "echo-agent", async (ctx, trigger) => {
      receivedContext = ctx;
      return {
        type: "reply",
        message: {
          sender: { id: "echo-agent", kind: "agent" },
          content: "got it",
        },
      };
    });

    chat.sendMessage(sid, userMsg("hi", {
      mentionedParticipants: ["echo-agent"],
    }));

    await new Promise((r) => setTimeout(r, 50));

    expect(receivedContext).toHaveLength(1);
    expect(receivedContext[0].kind).toBe("chat-history");
    expect(receivedContext[0].content).toBe("previous messages here");
  });

  it("respects chain depth limit", async () => {
    // Agent A triggers Agent B which triggers Agent A — should stop at depth limit
    const chat = createChatAbility({ maxChainDepth: 2 });
    const sid = chat.createSession({ id: "s1" });

    const agentA: Participant = {
      id: "agent-a",
      kind: "agent",
      name: "A",
      description: "",
      responseMode: { type: "on-mention" },
    };
    const agentB: Participant = {
      id: "agent-b",
      kind: "agent",
      name: "B",
      description: "",
      responseMode: { type: "on-mention" },
    };

    chat.registerParticipant(sid, human);
    chat.registerParticipant(sid, agentA);
    chat.registerParticipant(sid, agentB);

    // A's reply mentions B
    chat.registerAgentHandler(sid, "agent-a", async () => ({
      type: "reply",
      message: {
        sender: { id: "agent-a", kind: "agent" },
        content: "A replies, mentioning B",
        mentionedParticipants: ["agent-b"],
      },
    }));

    // B's reply mentions A (potential loop)
    chat.registerAgentHandler(sid, "agent-b", async () => ({
      type: "reply",
      message: {
        sender: { id: "agent-b", kind: "agent" },
        content: "B replies, mentioning A",
        mentionedParticipants: ["agent-a"],
      },
    }));

    chat.sendMessage(sid, userMsg("start", {
      mentionedParticipants: ["agent-a"],
    }));

    await new Promise((r) => setTimeout(r, 200));

    // user msg → A reply (depth 1) → B reply (depth 2) → stop (depth limit)
    const messages = chat.getMessages(sid);
    expect(messages.length).toBe(3); // user + A + B
  });

  it("handler returning null produces no reply", async () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    chat.registerParticipant(sid, human);
    chat.registerParticipant(sid, echoAgent);

    chat.registerAgentHandler(sid, "echo-agent", async () => null);

    chat.sendMessage(sid, userMsg("hi", {
      mentionedParticipants: ["echo-agent"],
    }));

    await new Promise((r) => setTimeout(r, 50));

    expect(chat.getMessages(sid)).toHaveLength(1); // only user msg
  });

  it("fires onMessage for agent replies", async () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    chat.registerParticipant(sid, human);
    chat.registerParticipant(sid, echoAgent);

    chat.registerAgentHandler(sid, "echo-agent", async () => ({
      type: "reply",
      message: {
        sender: { id: "echo-agent", kind: "agent" },
        content: "reply",
      },
    }));

    const onMessage = vi.fn();
    chat.on(sid, "onMessage", onMessage);

    chat.sendMessage(sid, userMsg("hi", {
      mentionedParticipants: ["echo-agent"],
    }));

    await new Promise((r) => setTimeout(r, 50));

    // Called twice: once for user msg, once for agent reply
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage.mock.calls[1][0].content).toBe("reply");
  });

  it("rejects registerAgentHandler for unregistered participant", () => {
    const chat = createChatAbility();
    const sid = chat.createSession({ id: "s1" });
    expect(() =>
      chat.registerAgentHandler(sid, "nonexistent", vi.fn()),
    ).toThrow("Participant not registered");
  });
});
