// Compiler
export type { CompileOptions, CompiledView } from "./compiler.js";
export { compile } from "./compiler.js";

// Adapter
export type { RenderAdapter } from "./adapter.js";
export { createAdapter } from "./adapter.js";

// Component registry
export type { ComponentMap } from "./component-registry.js";
export {
  registerComponent,
  getComponent,
  getComponentMap,
  clearComponentRegistry,
} from "./component-registry.js";
