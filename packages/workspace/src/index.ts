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
export type { CodocFile } from "@codoc/core";

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

// Skill system
export type { Skill } from "./skill/types.js";
export { registerSkill, getSkill, listSkills, identifySkill } from "./skill/registry.js";
export { claudeCodeLogSkill } from "./skill/claude-code-log.js";
export { ingestDirectory } from "./skill/ingest.js";
export type { IngestResult } from "./skill/ingest.js";

// Component library
export { ComponentLibrary } from "./component-library/library.js";
export type { WorkspaceComponent } from "./component-library/library.js";
export {
  diffSignature,
  checkCompatibility,
} from "./component-library/compat.js";
export type {
  SignatureChange,
  BreakingChangeKind,
  CompatIssue,
  CompatReport,
} from "./component-library/compat.js";
