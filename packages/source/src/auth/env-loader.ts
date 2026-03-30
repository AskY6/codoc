import type { ConnectorAuth } from "../connector-types.js";
import { getCredentialStore } from "./credential-store.js";

/**
 * Load credentials from an environment record into the credential store.
 * @param connectorName - The connector to associate credentials with.
 * @param envMapping - Maps credential keys to environment variable names.
 *                     e.g. { appId: "FEISHU_APP_ID", appSecret: "FEISHU_APP_SECRET" }
 * @param env - Environment variables record (defaults to process.env if available).
 */
export function loadEnvCredentials(
  connectorName: string,
  envMapping: Record<string, string>,
  env?: Record<string, string | undefined>,
): boolean {
  const envRecord = env ?? (typeof globalThis !== "undefined" && "process" in globalThis
    ? (globalThis as Record<string, unknown>)["process"] as { env: Record<string, string | undefined> }
    : undefined)?.env ?? {};

  const auth: ConnectorAuth = {};
  let hasAll = true;

  for (const [key, envVar] of Object.entries(envMapping)) {
    const value = envRecord[envVar];
    if (value) {
      auth[key] = value;
    } else {
      hasAll = false;
    }
  }

  if (Object.keys(auth).length > 0) {
    getCredentialStore().set(connectorName, auth);
  }

  return hasAll;
}
