import type { Workspace } from "@cobook/workspace";
import type { IntentQueue } from "./queue.js";
import type { IntentRecord } from "./types.js";
import { executeIntent } from "./executor.js";

/**
 * IntentQueueConsumer — watches for confirmed intents and executes them.
 *
 * All intents must carry a structured payload. The consumer delegates
 * execution to the single IntentExecutor.
 */
export class IntentQueueConsumer {
  private workspace: Workspace;
  private queue: IntentQueue;
  private processing = false;

  constructor(workspace: Workspace, queue: IntentQueue) {
    this.workspace = workspace;
    this.queue = queue;

    this.queue.subscribe((event) => {
      if (event.type === "status-changed" && event.status === "confirmed") {
        this.processNext();
      }
      if (event.type === "enqueued" && event.record.status === "confirmed") {
        this.processNext();
      }
    });

    this.workspace.onFieldChange((event) => {
      this.queue.markConflicts(event.docId, event.fieldPath);
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const confirmed = this.queue.getByStatus("confirmed");
      for (const record of confirmed) {
        if (!this.queue.canExecute()) {
          setTimeout(() => this.processNext(), 200);
          break;
        }
        await this.executeRecord(record);
        this.queue.recordExecution();
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeRecord(record: IntentRecord): Promise<void> {
    try {
      if (!record.payload) {
        throw new Error("Intent has no structured payload — cannot execute");
      }
      await executeIntent(
        this.workspace,
        record.payload.kind,
        record.payload.payload,
      );
      this.queue.transition(record.id, "executed");
      this.queue.transition(record.id, "propagated");
    } catch {
      this.queue.transition(record.id, "failed");
    }
  }
}
