// Real wall-clock used by the in-memory Storage. Stamped onto every
// `createdAt` / `updatedAt` so use case tests that don't care about
// timing can ignore Clock entirely. Tests that DO care can swap in
// their own `Clock` implementation when constructing the Storage.

import type { Clock, Timestamp } from "@cobook/storage";

export class SystemClock implements Clock {
  now(): Timestamp {
    return Date.now() as Timestamp;
  }
}
