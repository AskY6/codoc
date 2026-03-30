import { registerLoader } from "@codoc/core";
import { sourceLoader } from "./source-loader.js";
import { promptLoader } from "./providers/llm/loader.js";

/**
 * Register all source-package loaders into core's loader registry.
 * Call this once at application startup.
 */
export function registerSourceLoaders(): void {
  registerLoader("source", sourceLoader);
  registerLoader("prompt", promptLoader);
}
