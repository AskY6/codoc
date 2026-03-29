import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findTriggeredParticipants,
  matchesTriggerFilter,
  ChatBus,
} from "../bus.js";
import type { Message, Participant, TriggerFilter } from "../types.js";

function makeMessage(
  overrides?: Partial<Message>,
): Message {
  return {
    id: "msg-1",
    sender: { id: "user-1", kind: "human" },
    content: "hello world",
    timestamp: Date.now(),
    ...overrides,
  };
}

const mentionAgent: Participant = {
  id: "summary-agent",
  kind: "agent",
  name: "Summary",
  description: "",
  responseMode: { type: "on-mention" },
};

const daemonAgentResources: Participant = {
  id: "codoc-agent",
  kind: "agent",
  name: "Codoc",
  description: "",
  responseMode: {
    type: "daemon",
    filter: { resourceKinds: ["codoc"] },
  },
};

const daemonAgentIntents: Participant = {
  id: "intent-agent",
  kind: "agent",
  name: "Intent Watcher",
  description: "",
  responseMode: {
    type: "daemon",
    filter: { intentKinds: ["write-codoc-field"] },
  },
};

const passiveAgent: Participant = {
  id: "passive-agent",
  kind: "agent",
  name: "Passive",
  description: "",
  responseMode: { type: "passive" },
};

const humanParticipant: Participant = {
  id: "user-1",
  kind: "human",
  name: "User",
  description: "",
  responseMode: { type: "on-mention" },
};

describe("findTriggeredParticipants", () => {
  const participants = [mentionAgent, daemonAgentResources, daemonAgentIntents, passiveAgent, humanParticipant];

  it("triggers on-mention agent when mentioned", () => {
    const msg = makeMessage({ mentionedParticipants: ["summary-agent"] });
    const triggered = findTriggeredParticipants(msg, participants);
    expect(triggered).toEqual(["summary-agent"]);
  });

  it("does not trigger on-mention agent when not mentioned", () => {
    const msg = makeMessage({ mentionedParticipants: [] });
    const triggered = findTriggeredParticipants(msg, participants);
    // daemon won't trigger either since message has no matching resources/intents
    expect(triggered).toEqual([]);
  });

  it("triggers daemon agent when filter matches resourceKinds", () => {
    const msg = makeMessage({
      resourceRefs: [{ kind: "codoc", id: "doc-1" }],
    });
    const triggered = findTriggeredParticipants(msg, participants);
    expect(triggered).toContain("codoc-agent");
  });

  it("triggers daemon agent when filter matches intentKinds", () => {
    const msg = makeMessage({
      intents: [{ kind: "write-codoc-field", payload: {}, status: "proposed" }],
    });
    const triggered = findTriggeredParticipants(msg, participants);
    expect(triggered).toContain("intent-agent");
  });

  it("never triggers passive agent", () => {
    const msg = makeMessage({
      mentionedParticipants: ["passive-agent"],
      resourceRefs: [{ kind: "codoc", id: "doc-1" }],
    });
    const triggered = findTriggeredParticipants(msg, participants);
    expect(triggered).not.toContain("passive-agent");
  });

  it("never triggers human participant", () => {
    const msg = makeMessage({ mentionedParticipants: ["user-1"] });
    const triggered = findTriggeredParticipants(msg, participants);
    expect(triggered).not.toContain("user-1");
  });

  it("triggers multiple agents at once", () => {
    const msg = makeMessage({
      mentionedParticipants: ["summary-agent"],
      resourceRefs: [{ kind: "codoc", id: "doc-1" }],
    });
    const triggered = findTriggeredParticipants(msg, participants);
    expect(triggered).toContain("summary-agent");
    expect(triggered).toContain("codoc-agent");
  });
});

describe("matchesTriggerFilter", () => {
  it("matches when all specified filters pass", () => {
    const filter: TriggerFilter = {
      fromParticipants: ["user-1"],
      keywords: ["hello"],
    };
    const msg = makeMessage({ content: "hello world" });
    expect(matchesTriggerFilter(msg, filter)).toBe(true);
  });

  it("rejects when fromParticipants does not match", () => {
    const filter: TriggerFilter = { fromParticipants: ["other-user"] };
    const msg = makeMessage();
    expect(matchesTriggerFilter(msg, filter)).toBe(false);
  });

  it("rejects when resourceKinds does not match", () => {
    const filter: TriggerFilter = { resourceKinds: ["codoc"] };
    const msg = makeMessage({ resourceRefs: [] });
    expect(matchesTriggerFilter(msg, filter)).toBe(false);
  });

  it("rejects when intentKinds does not match", () => {
    const filter: TriggerFilter = { intentKinds: ["write-codoc-field"] };
    const msg = makeMessage({ intents: [] });
    expect(matchesTriggerFilter(msg, filter)).toBe(false);
  });

  it("rejects when keywords do not match", () => {
    const filter: TriggerFilter = { keywords: ["banana"] };
    const msg = makeMessage({ content: "hello world" });
    expect(matchesTriggerFilter(msg, filter)).toBe(false);
  });

  it("matches keywords case-insensitively", () => {
    const filter: TriggerFilter = { keywords: ["HELLO"] };
    const msg = makeMessage({ content: "hello world" });
    expect(matchesTriggerFilter(msg, filter)).toBe(true);
  });

  it("matches empty filter (no constraints = everything passes)", () => {
    const filter: TriggerFilter = {};
    const msg = makeMessage();
    expect(matchesTriggerFilter(msg, filter)).toBe(true);
  });

  it("uses OR logic within a filter dimension", () => {
    const filter: TriggerFilter = { resourceKinds: ["codoc", "code-snippet"] };
    const msg = makeMessage({
      resourceRefs: [{ kind: "code-snippet", id: "s1" }],
    });
    expect(matchesTriggerFilter(msg, filter)).toBe(true);
  });
});

describe("ChatBus", () => {
  it("registers and retrieves handlers", () => {
    const bus = new ChatBus();
    const handler = vi.fn();
    bus.registerHandler("agent-1", handler);
    expect(bus.getHandler("agent-1")).toBe(handler);
  });

  it("returns undefined for unregistered handler", () => {
    const bus = new ChatBus();
    expect(bus.getHandler("nope")).toBeUndefined();
  });

  describe("cooldown", () => {
    it("is not on cooldown initially", () => {
      const bus = new ChatBus({ cooldownMs: 500 });
      expect(bus.isOnCooldown("agent-1")).toBe(false);
    });

    it("is on cooldown after recordResponse", () => {
      const bus = new ChatBus({ cooldownMs: 500 });
      bus.recordResponse("agent-1");
      expect(bus.isOnCooldown("agent-1")).toBe(true);
    });

    it("cooldown expires after configured time", async () => {
      const bus = new ChatBus({ cooldownMs: 50 });
      bus.recordResponse("agent-1");
      expect(bus.isOnCooldown("agent-1")).toBe(true);
      await new Promise((r) => setTimeout(r, 60));
      expect(bus.isOnCooldown("agent-1")).toBe(false);
    });
  });

  describe("config", () => {
    it("uses default config", () => {
      const bus = new ChatBus();
      const cfg = bus.getConfig();
      expect(cfg.maxChainDepth).toBe(3);
      expect(cfg.cooldownMs).toBe(1000);
    });

    it("accepts custom config", () => {
      const bus = new ChatBus({ maxChainDepth: 5, cooldownMs: 2000 });
      const cfg = bus.getConfig();
      expect(cfg.maxChainDepth).toBe(5);
      expect(cfg.cooldownMs).toBe(2000);
    });
  });
});
