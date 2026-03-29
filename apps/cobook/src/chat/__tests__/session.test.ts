import { describe, it, expect } from "vitest";
import { MessageTree, buildMessage } from "../session.js";
import type { NewMessage } from "../types.js";

const human = { id: "user-1", kind: "human" as const };

function msg(content: string, overrides?: Partial<NewMessage>): NewMessage {
  return { sender: human, content, ...overrides };
}

describe("MessageTree", () => {
  it("starts empty", () => {
    const tree = new MessageTree();
    expect(tree.size).toBe(0);
    expect(tree.getActiveBranch()).toEqual([]);
    expect(tree.getActiveLeafId()).toBeNull();
  });

  it("adds messages linearly", () => {
    const tree = new MessageTree();
    const m1 = buildMessage(msg("hello"));
    const m2 = buildMessage(msg("world"));

    tree.addMessage(m1, null);
    tree.addMessage(m2, m1.id);

    expect(tree.size).toBe(2);
    const branch = tree.getActiveBranch();
    expect(branch.map((m) => m.content)).toEqual(["hello", "world"]);
    expect(tree.getActiveLeafId()).toBe(m2.id);
  });

  it("rejects add with non-existent parent", () => {
    const tree = new MessageTree();
    const m1 = buildMessage(msg("hello"));
    expect(() => tree.addMessage(m1, "nonexistent")).toThrow(
      "Parent message not found",
    );
  });

  describe("branching", () => {
    it("creates a branch at a message", () => {
      const tree = new MessageTree();
      const m1 = buildMessage(msg("root"));
      const m2 = buildMessage(msg("branch-a"));
      const m3 = buildMessage(msg("branch-b"));

      tree.addMessage(m1, null);
      tree.addMessage(m2, m1.id);

      // Branch at m1 — next message becomes sibling of m2
      tree.branchAt(m1.id);
      tree.addMessage(m3, m1.id);

      // Active branch should be root → branch-b
      const branch = tree.getActiveBranch();
      expect(branch.map((m) => m.content)).toEqual(["root", "branch-b"]);

      // m1 should have two children
      const node = tree.getNode(m1.id)!;
      expect(node.childIds).toEqual([m2.id, m3.id]);
    });

    it("switches to an existing branch", () => {
      const tree = new MessageTree();
      const m1 = buildMessage(msg("root"));
      const m2 = buildMessage(msg("branch-a"));
      const m3 = buildMessage(msg("branch-b"));

      tree.addMessage(m1, null);
      tree.addMessage(m2, m1.id);
      tree.branchAt(m1.id);
      tree.addMessage(m3, m1.id);

      // Currently on branch-b; switch to branch-a
      const path = tree.switchBranch(m2.id);
      expect(path).toEqual([m1.id, m2.id]);
      expect(tree.getActiveBranch().map((m) => m.content)).toEqual([
        "root",
        "branch-a",
      ]);
    });

    it("rejects branchAt with non-existent message", () => {
      const tree = new MessageTree();
      expect(() => tree.branchAt("nonexistent")).toThrow("Message not found");
    });

    it("rejects switchBranch with non-existent message", () => {
      const tree = new MessageTree();
      expect(() => tree.switchBranch("nonexistent")).toThrow(
        "Message not found",
      );
    });
  });

  describe("deep branching", () => {
    it("supports branches at different depths", () => {
      const tree = new MessageTree();
      const m1 = buildMessage(msg("a"));
      const m2 = buildMessage(msg("b"));
      const m3 = buildMessage(msg("c"));
      const m4 = buildMessage(msg("b-alt"));

      tree.addMessage(m1, null);
      tree.addMessage(m2, m1.id);
      tree.addMessage(m3, m2.id);

      // Branch at m1, add alternative b
      tree.branchAt(m1.id);
      tree.addMessage(m4, m1.id);

      expect(tree.getActiveBranch().map((m) => m.content)).toEqual([
        "a",
        "b-alt",
      ]);

      // Switch back to deep branch
      tree.switchBranch(m3.id);
      expect(tree.getActiveBranch().map((m) => m.content)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });
});

describe("buildMessage", () => {
  it("assigns id and timestamp", () => {
    const m = buildMessage(msg("test"));
    expect(m.id).toBeTruthy();
    expect(m.timestamp).toBeGreaterThan(0);
    expect(m.content).toBe("test");
    expect(m.sender).toEqual(human);
  });

  it("preserves optional fields", () => {
    const m = buildMessage(
      msg("test", {
        quotedIds: ["q1"],
        resourceRefs: [{ kind: "codoc", id: "doc1" }],
        mentionedParticipants: ["agent-1"],
        intents: [
          { kind: "write", payload: { field: "title" }, status: "proposed" },
        ],
      }),
    );
    expect(m.quotedIds).toEqual(["q1"]);
    expect(m.resourceRefs).toHaveLength(1);
    expect(m.mentionedParticipants).toEqual(["agent-1"]);
    expect(m.intents).toHaveLength(1);
  });
});
