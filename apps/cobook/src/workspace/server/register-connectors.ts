import { feishuConnectors } from "@codoc/source";
import { getConnectorCatalog } from "./connector-catalog.js";

/**
 * Populate the connector catalog with all shipped connectors,
 * then restore previously activated ones from workspace config.
 *
 * To ship a new connector package:
 *   1. import { connectors as xxxConnectors } from "@codoc/connector-xxx"
 *   2. Add to BUILTIN_CONNECTORS
 */
const BUILTIN_CONNECTORS = [
  ...feishuConnectors,
  // ...notionConnectors,
  // ...linearConnectors,
];

export async function registerAllConnectors(docsDir: string): Promise<void> {
  const catalog = getConnectorCatalog();
  catalog.setDocsDir(docsDir);

  for (const def of BUILTIN_CONNECTORS) {
    catalog.add(def);
  }

  await catalog.restore();
}
