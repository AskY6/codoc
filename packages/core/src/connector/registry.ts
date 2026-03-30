import type { ConnectorFn, ConnectorMeta } from "./types.js";

const connectors = new Map<string, { fn: ConnectorFn; meta: ConnectorMeta }>();

export function registerConnector(meta: ConnectorMeta, fn: ConnectorFn): void {
  connectors.set(meta.name, { fn, meta });
}

export function getConnector(name: string): ConnectorFn | undefined {
  return connectors.get(name)?.fn;
}

export function getConnectorMeta(name: string): ConnectorMeta | undefined {
  return connectors.get(name)?.meta;
}

export function listConnectors(): ConnectorMeta[] {
  return [...connectors.values()].map((c) => c.meta);
}

/** Reset registry — for testing only. */
export function clearConnectorRegistry(): void {
  connectors.clear();
}
