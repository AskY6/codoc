import { ConnectorClient } from "@cobook/local-connector";

let cached: ConnectorClient | null = null;
let pending: Promise<ConnectorClient> | null = null;

export function getConnector(): Promise<ConnectorClient> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    const client = new ConnectorClient({
      clientId: "cobook-web",
      productName: "Cobook",
      capabilities: [{ type: "filesystem", permissions: ["read"] }],
    });
    await client.connect();
    cached = client;
    pending = null;
    return client;
  })();

  return pending;
}
