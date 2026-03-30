import type { ConnectorFn, ConnectorMeta } from "./connector-types.js";

const connectors = new Map<string, { fn: ConnectorFn; meta: ConnectorMeta }>();

export function registerConnector(meta: ConnectorMeta, fn: ConnectorFn): void {
  connectors.set(meta.name, { fn, meta });
}

export function unregisterConnector(name: string): boolean {
  return connectors.delete(name);
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

export function clearConnectorRegistry(): void {
  connectors.clear();
}
