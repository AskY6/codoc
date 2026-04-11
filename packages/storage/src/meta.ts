// Storage-only metadata types. Core never sees these.
//
// - Rev:       opaque version token used for optimistic concurrency
//              control. The Store chooses its representation; services
//              only ever compare Revs they previously received from the
//              Store.
// - Timestamp: wall-clock time at which a row was created or last
//              updated. Stamped by the Store via an injected Clock so
//              that tests can drive time deterministically.

import type { Brand } from "@cobook/core";

export type Rev = Brand<string, "Rev">;
export type Timestamp = Brand<number, "Timestamp">;
