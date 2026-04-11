// Memory-flavoured storage context.
//
// Memory has no real transactions, so the ctx carries no DB handle —
// it only satisfies the opaque `Ctx` brand from `@cobook/storage`.
// `withTransaction` simply runs `fn` with a fresh `MemoryCtx` and
// commits unconditionally on success.

import type { Ctx } from "@cobook/storage";

export interface MemoryCtx extends Ctx {
  readonly __brand: "StorageCtx";
}

export const memoryCtx = (): MemoryCtx => ({ __brand: "StorageCtx" });
