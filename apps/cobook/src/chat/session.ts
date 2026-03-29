import type { Message, MessageNode, NewMessage, Participant } from "./types.js";

let counter = 0;
function genId(): string {
  return `msg_${Date.now()}_${++counter}`;
}

export class MessageTree {
  private nodes = new Map<string, MessageNode>();
  /** Ordered list of root message IDs (parentId === null). */
  private rootIds: string[] = [];
  /** ID of the current active leaf (tip of the active branch). */
  private activeLeafId: string | null = null;

  addMessage(msg: Message, parentId: string | null): MessageNode {
    if (parentId !== null && !this.nodes.has(parentId)) {
      throw new Error(`Parent message not found: ${parentId}`);
    }

    const node: MessageNode = {
      message: msg,
      parentId,
      childIds: [],
    };
    this.nodes.set(msg.id, node);

    if (parentId === null) {
      this.rootIds.push(msg.id);
    } else {
      this.nodes.get(parentId)!.childIds.push(msg.id);
    }

    this.activeLeafId = msg.id;
    return node;
  }

  getNode(id: string): MessageNode | undefined {
    return this.nodes.get(id);
  }

  /** Return the path from root to the active leaf. */
  getActiveBranch(): Message[] {
    if (this.activeLeafId === null) return [];

    const path: Message[] = [];
    let current: string | null = this.activeLeafId;
    while (current !== null) {
      const node = this.nodes.get(current);
      if (!node) break;
      path.push(node.message);
      current = node.parentId;
    }
    return path.reverse();
  }

  /** Return the active leaf ID. */
  getActiveLeafId(): string | null {
    return this.activeLeafId;
  }

  /**
   * Create a branch at the given message — the next addMessage after this
   * will create a sibling of the existing child, forming a fork.
   * Returns the messageId that becomes the new active leaf (the branch point itself).
   */
  branchAt(messageId: string): string {
    if (!this.nodes.has(messageId)) {
      throw new Error(`Message not found: ${messageId}`);
    }
    this.activeLeafId = messageId;
    return messageId;
  }

  /**
   * Switch the active branch so that `leafMessageId` is the active leaf.
   * Validates that the message exists.
   */
  switchBranch(leafMessageId: string): string[] {
    if (!this.nodes.has(leafMessageId)) {
      throw new Error(`Message not found: ${leafMessageId}`);
    }
    this.activeLeafId = leafMessageId;
    return this.getActiveBranch().map((m) => m.id);
  }

  /** Return all message IDs on the active branch path. */
  getActivePath(): string[] {
    return this.getActiveBranch().map((m) => m.id);
  }

  get size(): number {
    return this.nodes.size;
  }
}

export interface SessionData {
  id: string;
  participants: Participant[];
  messageTree: MessageTree;
}

export function createSession(id: string): SessionData {
  return {
    id,
    participants: [],
    messageTree: new MessageTree(),
  };
}

export function buildMessage(input: NewMessage): Message {
  return {
    ...input,
    id: genId(),
    timestamp: Date.now(),
  };
}
