// Compiler
export type { CompileOptions, CompiledView } from "./compiler.js";
export { compile } from "./compiler.js";

// Adapter
export type { RenderAdapter } from "./adapter.js";
export { createAdapter } from "./adapter.js";

// Bundle resolver
export type {
  ResolvedComponent,
  BundleResolverOptions,
  ResolveResult,
} from "./bundle-resolver.js";
export { resolveComponentBundles } from "./bundle-resolver.js";

// Component registry
export type { ComponentMap } from "./component-registry.js";
export {
  registerComponent,
  getComponent,
  getComponentMap,
  clearComponentRegistry,
  buildComponentScope,
} from "./component-registry.js";
