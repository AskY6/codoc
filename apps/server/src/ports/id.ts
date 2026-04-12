// Production `IdGenerator` impl: native `crypto.randomUUID()` for
// every brand. Lives in the composition root because choosing a UUID
// flavour is an infrastructure decision, not a service decision.

import type {
  AgentId,
  CodocId,
  MessageId,
  SessionId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import type { IdGenerator } from "@cobook/service";

export class UuidIdGenerator implements IdGenerator {
  workspaceId(): WorkspaceId {
    return crypto.randomUUID() as WorkspaceId;
  }
  codocId(): CodocId {
    return crypto.randomUUID() as CodocId;
  }
  threadId(): ThreadId {
    return crypto.randomUUID() as ThreadId;
  }
  messageId(): MessageId {
    return crypto.randomUUID() as MessageId;
  }
  agentId(): AgentId {
    return crypto.randomUUID() as AgentId;
  }
  sessionId(): SessionId {
    return crypto.randomUUID() as SessionId;
  }
}
