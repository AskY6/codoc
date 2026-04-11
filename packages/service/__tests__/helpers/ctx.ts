// Test helper that builds a fresh `ServiceCtx` against a real
// in-memory `Storage`. Use case tests must run against this — see
// `src/usecases/AGENTS.md` for the no-mocks rule.
//
// Each call returns a brand-new storage + ctx pair, so tests are
// isolated by construction.

import type { WorkspaceId } from "@cobook/core";
import { SystemClock, createMemoryStorage } from "@cobook/storage-memory";
import type { ServiceCtx } from "../../src/context.js";
import type { IdGenerator } from "../../src/ports/id.js";

/**
 * Deterministic id generator. Each call returns `ws_1`, `ws_2`, …
 * which makes assertions trivial and matches the convention real
 * fakes use elsewhere in the codebase.
 */
export function counterIdGenerator(): IdGenerator {
  let n = 0;
  return {
    workspaceId(): WorkspaceId {
      return `ws_${++n}` as WorkspaceId;
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
