import { registerLoader } from "@codoc/core";
import { sourceLoader } from "./source-loader.js";
import { promptLoader } from "./providers/llm/loader.js";
import { registerConnector } from "./connector-registry.js";
import { localFileMeta, localFileConnector } from "./providers/local-file/setup.js";
import { localDirectoryMeta, localDirectoryConnector } from "./providers/local-directory/setup.js";

/**
 * Register all source-package loaders into core's loader registry.
 * Also registers built-in connectors (local-file, local-directory).
 * Call this once at application startup.
 */
export function registerSourceLoaders(): void {
  registerLoader("source", sourceLoader);
  registerLoader("prompt", promptLoader);

  // Built-in connectors for local filesystem access
  registerConnector(localFileMeta, localFileConnector);
  registerConnector(localDirectoryMeta, localDirectoryConnector);
}
