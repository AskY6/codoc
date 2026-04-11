// Injectable wall-clock. Storage implementations use Clock to stamp
// `createdAt` / `updatedAt` so tests can substitute a fake time source.
// Kept as a standalone port so the Clock contract is independent of any
// particular Store interface.

import type { Timestamp } from "./meta.js";

export interface Clock {
  now(): Timestamp;
}
