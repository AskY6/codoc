// Test helper that builds a fresh `ServiceCtx` against a real
// in-memory `Storage`. Use case tests must run against this — see
// `src/usecases/AGENTS.md` for the no-mocks rule.
//
// Each call returns a brand-new storage + ctx pair, so tests are
// isolated by construction.

import type {
  CodocId,
  MessageId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import { SystemClock, createMemoryStorage } from "@cobook/storage-memory";
import type { ServiceCtx } from "../../src/context.js";
import type { IdGenerator } from "../../src/ports/id.js";

/**
 * Deterministic id generator. Each brand has its own counter so that
 * `ws_1`, `codoc_1`, `thread_1`, and `msg_1` never collide even when
 * tests mint ids in interleaved order. Matches the convention real
 * fakes use elsewhere in the codebase.
 */
export function counterIdGenerator(): IdGenerator {
  let ws = 0;
  let codoc = 0;
  let thread = 0;
  let msg = 0;
  return {
    workspaceId(): WorkspaceId {
      return `ws_${++ws}` as WorkspaceId;
    },
    codocId(): CodocId {
      return `codoc_${++codoc}` as CodocId;
    },
    threadId(): ThreadId {
      return `thread_${++thread}` as ThreadId;
    },
    messageId(): MessageId {
      return `msg_${++msg}` as MessageId;
    },
  };
}

export interface TestCtxBundle {
  readonly ctx: ServiceCtx;
}

export function makeTestCtx(): TestCtxBundle {
  const clock = new SystemClock();
  const storage = createMemoryStorage({ clock });
  const ctx: ServiceCtx = {
    storage,
    storageCtx: storage.ctx(),
    clock,
    idGen: counterIdGenerator(),
  };
  return { ctx };
}
