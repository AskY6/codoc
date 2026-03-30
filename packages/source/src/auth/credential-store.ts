import type { ConnectorAuth } from "../connector-types.js";

class CredentialStore {
  private creds = new Map<string, ConnectorAuth>();

  set(connectorName: string, auth: ConnectorAuth): void {
    this.creds.set(connectorName, auth);
  }

  get(connectorName: string): ConnectorAuth | undefined {
    return this.creds.get(connectorName);
  }

  has(connectorName: string): boolean {
    return this.creds.has(connectorName);
  }

  clear(): void {
    this.creds.clear();
  }
}

let store: CredentialStore | undefined;

export function getCredentialStore(): CredentialStore {
  if (!store) store = new CredentialStore();
  return store;
}
