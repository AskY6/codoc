import type { DataTree } from "@codoc/core";
import type { DAG } from "@codoc/graph";

export interface DocEntry {
  tree: DataTree;
  dag: DAG;
}

/**
 * Registry of loaded .codoc document instances.
 * Provides lookup by docId and tracks cross-doc subscriptions.
 */
export class DocRegistry {
  private docs = new Map<string, DocEntry>();
  private consumers = new Map<string, Set<string>>();
  private subscriptions = new Map<string, () => void>();

  register(docId: string, tree: DataTree, dag: DAG): void {
    this.docs.set(docId, { tree, dag });
  }

  get(docId: string): DocEntry | undefined {
    return this.docs.get(docId);
  }

  has(docId: string): boolean {
    return this.docs.has(docId);
  }

  unregister(docId: string): void {
    for (const [key, unsub] of this.subscriptions) {
      if (key.startsWith(`${docId}:`)) {
        unsub();
        this.subscriptions.delete(key);
      }
    }
    for (const [, consumers] of this.consumers) {
      for (const consumer of consumers) {
        if (consumer.startsWith(`${docId}:`)) {
          consumers.delete(consumer);
        }
      }
    }
    this.docs.delete(docId);
  }

  getAllDocIds(): string[] {
    return [...this.docs.keys()];
  }

  addConsumer(
    targetDocId: string,
    targetFieldPath: string,
    consumerDocId: string,
    consumerFieldPath: string,
    onTargetChange: () => void,
  ): void {
    const targetKey = `${targetDocId}:${targetFieldPath}`;
    const consumerKey = `${consumerDocId}:${consumerFieldPath}`;

    let set = this.consumers.get(targetKey);
    if (!set) {
      set = new Set();
      this.consumers.set(targetKey, set);
    }
    set.add(consumerKey);

    const subKey = `${consumerKey}->${targetKey}`;
    if (!this.subscriptions.has(subKey)) {
      const targetEntry = this.docs.get(targetDocId);
      if (targetEntry) {
        const unsub = targetEntry.tree.subscribeField(targetFieldPath, onTargetChange);
        this.subscriptions.set(subKey, unsub);
      }
    }
  }

  getConsumers(
    targetDocId: string,
    targetFieldPath: string,
  ): Array<{ docId: string; fieldPath: string }> {
    const key = `${targetDocId}:${targetFieldPath}`;
    const set = this.consumers.get(key);
    if (!set) return [];
    return [...set].map((consumer) => {
      const colonIdx = consumer.indexOf(":");
      return {
        docId: consumer.slice(0, colonIdx),
        fieldPath: consumer.slice(colonIdx + 1),
      };
    });
  }
}

// Module-level singleton
let registry: DocRegistry | null = null;

export function setDocRegistry(r: DocRegistry): void {
  registry = r;
}

export function getDocRegistry(): DocRegistry | null {
  return registry;
}
