// Service
export { createWorkspaceService } from "./workspace-service.js";
export type { WorkspaceService, WorkspaceServiceDeps } from "./workspace-service.js";

// Source executor
export { executeSource, registerSource } from "./source-executor.js";

// Chat service
export { createChatService } from "./chat-service.js";
export type { ChatService, ChatServiceDeps } from "./chat-service.js";

// Types
export { SourceError } from "./types.js";
export type {
  BuildDiagnostics,
  DiagnosticError,
  WorkspaceStatus,
  CodocInfo,
  CodocListItem,
  WorkspaceGraph,
  WorkspaceGraphNode,
  WorkspaceGraphEdge,
  WorkspacePresetSummary,
  WorkspacePresetDefinition,
} from "./types.js";

// Re-export storage pieces needed by HTTP routes / server bootstrap so that
// apps/server doesn't have to import from @cobook/storage directly. Routes
// must only depend on @cobook/service — this is what makes the service layer
// the true boundary between HTTP and physical storage.
export { createDb } from "@cobook/storage";
export type {
  Database,
  Workspace,
  WorkspaceListItem,
  Codoc,
} from "@cobook/storage";

export {
  listWorkspacePresets,
  getWorkspacePreset,
  applyWorkspacePreset,
} from "./presets/index.js";
