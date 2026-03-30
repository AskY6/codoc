import type { ConnectorDefinition } from "@codoc/core";
import { feishuTableMeta, feishuTableConnector } from "./table.js";
import { feishuDocMeta, feishuDocConnector } from "./doc.js";
import { feishuBotMeta, feishuBotConnector } from "./bot.js";

const FEISHU_ENV_AUTH = {
  appId: "FEISHU_APP_ID",
  appSecret: "FEISHU_APP_SECRET",
};

/**
 * All feishu connector definitions.
 * Each can be independently activated by the app.
 */
export const connectors: ConnectorDefinition[] = [
  { meta: feishuTableMeta, fn: feishuTableConnector, envAuth: FEISHU_ENV_AUTH },
  { meta: feishuDocMeta, fn: feishuDocConnector, envAuth: FEISHU_ENV_AUTH },
  { meta: feishuBotMeta, fn: feishuBotConnector, envAuth: FEISHU_ENV_AUTH },
];
