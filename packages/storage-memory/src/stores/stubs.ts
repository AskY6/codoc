// Throwing stand-ins for every storage store other than the real
// in-memory impls. Each property is a Proxy whose every method raises
// `NotImplementedError`. Future vertical slices replace these one at
// a time as the slice needs them.

import type {
  AgentSessionStore,
  AgentStore,
  ThreadAgentStore,
  ThreadCodocStore,
  WorkspaceAgentStore,
} from "@cobook/storage";
import { notImplementedStore } from "../not-implemented.js";

export const agentStub: AgentStore = notImplementedStore<AgentStore>("agents");
export const threadCodocStub: ThreadCodocStore =
  notImplementedStore<ThreadCodocStore>("threadCodocs");
export const threadAgentStub: ThreadAgentStore =
  notImplementedStore<ThreadAgentStore>("threadAgents");
export const workspaceAgentStub: WorkspaceAgentStore =
  notImplementedStore<WorkspaceAgentStore>("workspaceAgents");
export const sessionStub: AgentSessionStore =
  notImplementedStore<AgentSessionStore>("sessions");
