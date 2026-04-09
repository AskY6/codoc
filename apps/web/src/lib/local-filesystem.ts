import { ConnectorClient, type ConnectorStatus } from "@cobook/local-connector";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

let cached: ConnectorClient | null = null;
let pending: Promise<ConnectorClient> | null = null;

// Connector status store (reactive)
let currentStatus: ConnectorStatus = "idle";
let prevStatus: ConnectorStatus = "idle";
const statusListeners = new Set<() => void>();

function setStatus(s: ConnectorStatus) {
  prevStatus = currentStatus;
  currentStatus = s;

  // Toast on meaningful transitions
  if (s === "reconnecting" && prevStatus === "ready") {
    toast.warning("Local connector disconnected, reconnecting...");
  } else if (s === "ready" && prevStatus === "reconnecting") {
    toast.success("Local connector reconnected");
  } else if (s === "closed" && prevStatus !== "idle") {
    toast.error("Local connector connection closed");
  }

  for (const fn of statusListeners) fn();
}

export function getConnector(): Promise<ConnectorClient> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    const client = new ConnectorClient({
      clientId: "cobook-web",
      productName: "Cobook",
      capabilities: [{ type: "filesystem", permissions: ["read"] }],
    });
    client.onStatusChange(setStatus);
    await client.connect();
    cached = client;
    pending = null;
    return client;
  })();

  pending.catch(() => {
    pending = null;
  });

  return pending;
}

export function useConnectorStatus(): ConnectorStatus {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => currentStatus,
  );
}
