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

// Credential store
export { getCredentialStore } from "./auth/credential-store.js";

// Source loader
export { sourceLoader } from "./source-loader.js";
export { clearSourceCache, evictSourceCache, getSourceCacheSize, stableStringify, buildConnectorCacheKey } from "./cache/store.js";

// LLM / prompt loader
export { promptLoader, setLLMClient, getLLMClient, extractTemplateVars } from "./providers/llm/loader.js";

// Feishu providers
export { feishuTableConnector, feishuTableMeta } from "./providers/feishu/table.js";
export { feishuDocConnector, feishuDocMeta } from "./providers/feishu/doc.js";
export { feishuBotConnector, feishuBotMeta } from "./providers/feishu/bot.js";
export { getTenantToken, clearTokenCache } from "./providers/feishu/auth.js";
export { connectors as feishuConnectors } from "./providers/feishu/setup.js";

// Registration helper
export { registerSourceLoaders } from "./register-all.js";
