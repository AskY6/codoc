// Client-safe exports: everything from index.ts except Workspace (which uses node:fs)

export { DataTree } from "./data-tree.js";
export { validate } from "./schema.js";
export { literalLoader } from "./loader/literal.js";
export { refLoader } from "./loader/ref.js";
export { sourceLoader, clearSourceCache, evictSourceCache, getSourceCacheSize } from "./loader/source.js";
export { promptLoader, setLLMClient, getLLMClient, extractTemplateVars } from "./loader/prompt.js";
export { externalLoader } from "./loader/external.js";
export { getLoader, registerLoader } from "./loader/registry.js";
export { extractDeps, extractAllDeps, extractExternalDeps } from "./dep-extractor.js";
export type { ExternalDep } from "./dep-extractor.js";
export { DAG } from "./dag.js";
export type { CyclicDependencyError } from "./dag.js";
export { topoSort, topoLayers } from "./topo-sort.js";
export { propagateDirty, propagateAndInvalidate } from "./dirty-propagator.js";
export { scheduleForce } from "./scheduler.js";
export type { SchedulerOptions, SchedulerResult } from "./scheduler.js";
export { SourceScheduler } from "./source-scheduler.js";
export type { SourceSchedulerOptions } from "./source-scheduler.js";
export { parseCodoc } from "./codoc-loader.js";
export { isExternalRef, parseExternalRef } from "./resolver.js";
export type { ExternalRef } from "./resolver.js";
export { DocRegistry, setDocRegistry, getDocRegistry } from "./doc-registry.js";
export type { DocEntry } from "./doc-registry.js";
export {
  crossDocPropagate,
  wireExternalDeps,
  buildDocDAG,
  detectDocCycle,
  docDAGtoDot,
} from "./cross-doc-propagator.js";
export type { DocDAGEdge } from "./cross-doc-propagator.js";
// Workspace types only (no runtime import of node:fs)
export type {
  DocMeta,
  FieldMeta,
  FieldAddress,
  DepEdge,
  WorkspaceChangeEvent,
  CodocRuntime,
} from "./workspace.js";
export type {
  CodataDefinition,
  CodataField,
  CodataMeta,
  CodocFile,
  FieldError,
  FieldState,
  ForceContext,
  LLMClient,
  LoaderDeclaration,
  LoaderFn,
  PromptDeclaration,
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
} from "./types.js";
