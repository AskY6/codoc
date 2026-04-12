import type { Clock, Timestamp } from "@cobook/storage";

export class SystemClock implements Clock {
  now(): Timestamp {
    return Date.now() as Timestamp;
  }
}
