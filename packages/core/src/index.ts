// Model — data layer
export type {
  CodataField,
  CodataMeta,
  FieldError,
  FieldState,
  LoaderDeclaration,
  PromptDeclaration,
  SourceConnectorConfig,
} from "./model/data.js";

// Model — codoc definitions & loader interface
export type {
  CodataDefinition,
  CodocFile,
  ForceContext,
  LoaderFn,
  LLMClient,
} from "./model/codoc.js";

// Model — schema / validation types
export type {
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
} from "./model/schema.js";

// Model — view types
export type { ViewTemplate } from "./model/view.js";

// Model — resolver
export { isExternalRef, parseExternalRef } from "./model/resolver.js";
export type { ExternalRef } from "./model/resolver.js";

// Loader
export type {} from "./loader/interface.js";
export { literalLoader } from "./loader/literal.js";
export { refLoader } from "./loader/ref.js";
export { getLoader, registerLoader } from "./loader/registry.js";

// Codata
export { DataTree } from "./codata/tree.js";
export { resolveLoaderDeclaration, createField } from "./codata/node.js";
export { canMarkDirty, needsForce } from "./codata/state.js";
export { observe } from "./codata/observe.js";

// Validation
export { validate } from "./validation/schema-validator.js";

// Runtime
export { executeForce } from "./runtime/runtime.js";
export { forceField, wrapError } from "./runtime/force.js";
export { SubscriptionManager } from "./runtime/subscribe.js";
