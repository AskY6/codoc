// @cobook/storage-memory — in-process `Storage` implementation.
//
// Used by use case tests and by the dev server until a real DB-backed
// adapter ships. See `./AGENTS.md` for the stub-store convention and
// the "memory tx is a no-op" caveat.

export { createMemoryStorage } from "./storage.js";
export type { CreateMemoryStorageOptions } from "./storage.js";
export { SystemClock } from "./clock.js";
export { NotImplementedError } from "./not-implemented.js";
