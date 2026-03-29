import { describe, it, expect, vi } from "vitest";
import { createChatAbility } from "../index.js";
import type { Message, NewMessage, Participant } from "../types.js";

const humanParticipant: Participant = {
  id: "user-1",
  kind: "human",
  name: "Alice",
  description: "Human user",
  responseMode: { type: "on-mention" },
};

const agentParticipant: Participant = {
  id: "summary-agent",
  kind: "agent",
  name: "Summary Agent",
  description: "Summarizes conversations",
  responseMode: { type: "on-mention" },
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required" },
  ],
};

function userMsg(content: string, extras?: Partial<NewMessage>): NewMessage {
  return {
    sender: { id: "user-1", kind: "human" },
    content,
    ...extras,
  };
}

describe("ChatAbility", () => {
  describe("session lifecycle", () => {
    it("creates a session with auto-generated id", () => {
      const chat = createChatAbility();
      const id = chat.createSession();
      expect(id).toBeTruthy();
    });

    it("creates a session with custom id", () => {
      const chat = createChatAbility();
      const id = chat.createSession({ id: "my-session" });
      expect(id).toBe("my-session");
    });

    it("rejects duplicate session id", () => {
      const chat = createChatAbility();
      chat.createSession({ id: "s1" });
      expect(() => chat.createSession({ id: "s1" })).toThrow(
        "Session already exists",
      );
    });

    it("throws on unknown session", () => {
      const chat = createChatAbility();
      expect(() => chat.sendMessage("nope", userMsg("hi"))).toThrow(
        "Session not found",
      );
    });
  });

  describe("participants", () => {
    it("registers and lists participants", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      chat.registerParticipant(sid, humanParticipant);
      chat.registerParticipant(sid, agentParticipant);

      const participants = chat.getParticipants(sid);
      expect(participants).toHaveLength(2);
      expect(participants.map((p) => p.id)).toEqual([
        "user-1",
        "summary-agent",
      ]);
    });

    it("rejects duplicate participant id", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      chat.registerParticipant(sid, humanParticipant);
      expect(() => chat.registerParticipant(sid, humanParticipant)).toThrow(
        "Participant already registered",
      );
    });

    it("fires onParticipantJoin event", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      const handler = vi.fn();
      chat.on(sid, "onParticipantJoin", handler);
      chat.registerParticipant(sid, agentParticipant);
      expect(handler).toHaveBeenCalledWith(agentParticipant);
    });
  });

  describe("messaging", () => {
    it("sends and retrieves messages", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();

      const m1 = chat.sendMessage(sid, userMsg("hello"));
      const m2 = chat.sendMessage(sid, userMsg("world"));

      expect(m1.id).toBeTruthy();
      expect(m1.timestamp).toBeGreaterThan(0);

      const messages = chat.getMessages(sid);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("hello");
      expect(messages[1].content).toBe("world");
    });

    it("fires onMessage event", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      const handler = vi.fn();
      chat.on(sid, "onMessage", handler);

      const sent = chat.sendMessage(sid, userMsg("test"));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(sent);
    });
  });

  describe("intents", () => {
    it("updates intent status and fires event", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();

      const msg = chat.sendMessage(
        sid,
        userMsg("write this", {
          intents: [
            {
              kind: "write-codoc-field",
              payload: { field: "title", value: "Hello" },
              status: "proposed",
            },
          ],
        }),
      );

      const handler = vi.fn();
      chat.on(sid, "onIntentStatusChange", handler);

      chat.updateIntentStatus(sid, msg.id, 0, "confirmed");

      expect(handler).toHaveBeenCalledWith(msg.id, 0, "confirmed");
      const intent = chat.getIntent(sid, msg.id, 0);
      expect(intent.status).toBe("confirmed");
    });

    it("throws on invalid intent index", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      const msg = chat.sendMessage(sid, userMsg("no intents"));

      expect(() => chat.updateIntentStatus(sid, msg.id, 0, "confirmed")).toThrow(
        "Intent not found",
      );
    });

    it("throws on non-existent message", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      expect(() =>
        chat.updateIntentStatus(sid, "nonexistent", 0, "confirmed"),
      ).toThrow("Message not found");
    });

    it("handles multiple intents on one message", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();

      const msg = chat.sendMessage(
        sid,
        userMsg("multi", {
          intents: [
            { kind: "write", payload: "a", status: "proposed" },
            { kind: "delete", payload: "b", status: "proposed" },
          ],
        }),
      );

      chat.updateIntentStatus(sid, msg.id, 0, "confirmed");
      chat.updateIntentStatus(sid, msg.id, 1, "rejected");

      expect(chat.getIntent(sid, msg.id, 0).status).toBe("confirmed");
      expect(chat.getIntent(sid, msg.id, 1).status).toBe("rejected");
    });
  });

  describe("branching", () => {
    it("creates a branch and switches between branches", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();

      const m1 = chat.sendMessage(sid, userMsg("root"));
      const m2 = chat.sendMessage(sid, userMsg("branch-a"));

      // Branch at root
      chat.branchAt(sid, m1.id);
      const m3 = chat.sendMessage(sid, userMsg("branch-b"));

      // Active branch should be root → branch-b
      let messages = chat.getMessages(sid);
      expect(messages.map((m) => m.content)).toEqual(["root", "branch-b"]);

      // Switch to branch-a
      chat.switchBranch(sid, m2.id);
      messages = chat.getMessages(sid);
      expect(messages.map((m) => m.content)).toEqual(["root", "branch-a"]);
    });

    it("fires onBranchSwitch event", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();

      const m1 = chat.sendMessage(sid, userMsg("root"));
      const m2 = chat.sendMessage(sid, userMsg("a"));

      chat.branchAt(sid, m1.id);
      chat.sendMessage(sid, userMsg("b"));

      const handler = vi.fn();
      chat.on(sid, "onBranchSwitch", handler);

      chat.switchBranch(sid, m2.id);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith([m1.id, m2.id]);
    });
  });

  describe("event unsubscribe", () => {
    it("stops receiving events after unsubscribe", () => {
      const chat = createChatAbility();
      const sid = chat.createSession();
      const handler = vi.fn();
      const unsub = chat.on(sid, "onMessage", handler);

      chat.sendMessage(sid, userMsg("first"));
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      chat.sendMessage(sid, userMsg("second"));
      expect(handler).toHaveBeenCalledTimes(1); // still 1
    });
  });

  describe("session isolation", () => {
    it("sessions do not share state", () => {
      const chat = createChatAbility();
      const s1 = chat.createSession();
      const s2 = chat.createSession();

      chat.sendMessage(s1, userMsg("in s1"));
      chat.sendMessage(s2, userMsg("in s2"));

      expect(chat.getMessages(s1).map((m) => m.content)).toEqual(["in s1"]);
      expect(chat.getMessages(s2).map((m) => m.content)).toEqual(["in s2"]);
    });

    it("events do not leak between sessions", () => {
      const chat = createChatAbility();
      const s1 = chat.createSession();
      const s2 = chat.createSession();
      const handler = vi.fn();
      chat.on(s1, "onMessage", handler);

      chat.sendMessage(s2, userMsg("s2 msg"));
      expect(handler).not.toHaveBeenCalled();

      chat.sendMessage(s1, userMsg("s1 msg"));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
