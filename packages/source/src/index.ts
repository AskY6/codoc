// Connector types & registry
export type { ConnectorFn, ConnectorAuth, ConnectorMeta, ConnectorDefinition } from "./connector-types.js";
export {
  registerConnector,
  unregisterConnector,
  getConnector,
  getConnectorMeta,
  listConnectors,
  clearConnectorRegistry,
} from "./connector-registry.js";

// Credential store & env loader
export { getCredentialStore } from "./auth/credential-store.js";
export { loadEnvCredentials } from "./auth/env-loader.js";

// Cache
export type { CacheStrategy } from "./cache/strategy.js";
export { defaultStrategy } from "./cache/strategy.js";
export { clearSourceCache, evictSourceCache, getSourceCacheSize, stableStringify, buildConnectorCacheKey } from "./cache/store.js";

// Source loader
export { sourceLoader } from "./source-loader.js";

// Parsers
export { parseJson } from "./parsers/json.js";
export { parseJsonl } from "./parsers/jsonl.js";

// Providers — HTTP
export { fetchUrl } from "./providers/http/loader.js";

// Providers — Local file
export { loadLocalFile } from "./providers/local-file/loader.js";
export type { LocalFileOptions } from "./providers/local-file/loader.js";
export { createLocalFileWatcher } from "./providers/local-file/watcher.js";
export type { LocalFileWatcher } from "./providers/local-file/watcher.js";
export { localFileConnector, localFileMeta, connector as localFileConnectorDef } from "./providers/local-file/setup.js";

// Providers — Local directory
export { loadLocalDirectory } from "./providers/local-directory/loader.js";
export type { LocalDirectoryOptions, DirectoryEntry } from "./providers/local-directory/loader.js";
export { createLocalDirectoryWatcher } from "./providers/local-directory/watcher.js";
export type { DirectoryChangeEvent, LocalDirectoryWatcher } from "./providers/local-directory/watcher.js";
export { localDirectoryConnector, localDirectoryMeta, connector as localDirectoryConnectorDef } from "./providers/local-directory/setup.js";

// Providers — LLM / prompt
export { promptLoader, setLLMClient, getLLMClient, extractTemplateVars } from "./providers/llm/loader.js";

// Providers — Feishu
export { feishuTableConnector, feishuTableMeta } from "./providers/feishu/table.js";
export { feishuDocConnector, feishuDocMeta } from "./providers/feishu/doc.js";
export { feishuBotConnector, feishuBotMeta } from "./providers/feishu/bot.js";
export { getTenantToken, clearTokenCache } from "./providers/feishu/auth.js";
export { connectors as feishuConnectors } from "./providers/feishu/setup.js";

// Registration helper
export { registerSourceLoaders } from "./register-all.js";
