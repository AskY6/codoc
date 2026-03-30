// Workspace API
export { Workspace } from "./api/workspace-api.js";
export type {
  DocMeta,
  FieldMeta,
  FieldAddress,
  DepEdge,
  WorkspaceChangeEvent,
  CodocRuntime,
} from "./api/types.js";

// Lifecycle
export { parseCodoc } from "./lifecycle/codoc-factory.js";
export { DocRegistry, setDocRegistry, getDocRegistry } from "./lifecycle/instance-store.js";
export type { DocEntry } from "./lifecycle/instance-store.js";
export { externalLoader } from "./lifecycle/external-loader.js";
export {
  extractDeps,
  extractAllDeps,
  extractExternalDeps,
} from "./lifecycle/dep-extractor.js";
export type { ExternalDep } from "./lifecycle/dep-extractor.js";
export {
  crossDocPropagate,
  wireExternalDeps,
  buildDocDAG,
  detectDocCycle,
  docDAGtoDot,
} from "./lifecycle/manager.js";
export type { DocDAGEdge } from "./lifecycle/manager.js";

// Wiring
export {
  buildDAGFromTree,
  scheduleForce,
  registerWorkspaceLoaders,
} from "./wiring/bootstrap.js";
export type { SchedulerOptions, SchedulerResult } from "./wiring/bootstrap.js";
export { propagateAndInvalidate } from "./wiring/dirty-helpers.js";

// Watch
export { SourceScheduler } from "./watch/source-binding.js";
export type { SourceSchedulerOptions } from "./watch/source-binding.js";
export { WatchOrchestrator } from "./watch/orchestrator.js";
export type { WatchEvent, WatchHandler } from "./watch/orchestrator.js";
