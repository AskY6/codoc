import { describe, it, expect, beforeEach } from "vitest";
import {
  registerConnector,
  getConnector,
  getConnectorMeta,
  listConnectors,
  clearConnectorRegistry,
} from "../connector/registry.js";
import { getCredentialStore } from "../connector/credential-store.js";
import type { ConnectorMeta } from "../connector/types.js";

const testMeta: ConnectorMeta = {
  name: "test-connector",
  displayName: "Test Connector",
  description: "A test connector",
  configSchema: { type: "object" },
  authSchema: { type: "object" },
  exampleYaml: "test: true",
};

describe("Connector Registry", () => {
  beforeEach(() => {
    clearConnectorRegistry();
  });

  it("registers and retrieves a connector function", () => {
    const fn = async () => ({ data: 1 });
    registerConnector(testMeta, fn);

    expect(getConnector("test-connector")).toBe(fn);
  });

  it("returns undefined for unknown connector", () => {
    expect(getConnector("nonexistent")).toBeUndefined();
  });

  it("retrieves connector metadata", () => {
    registerConnector(testMeta, async () => ({}));

    expect(getConnectorMeta("test-connector")).toEqual(testMeta);
  });

  it("returns undefined meta for unknown connector", () => {
    expect(getConnectorMeta("nonexistent")).toBeUndefined();
  });

  it("lists all registered connectors", () => {
    const meta2: ConnectorMeta = { ...testMeta, name: "second", displayName: "Second" };
    registerConnector(testMeta, async () => ({}));
    registerConnector(meta2, async () => ({}));

    const list = listConnectors();
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.name)).toContain("test-connector");
    expect(list.map((m) => m.name)).toContain("second");
  });

  it("clearConnectorRegistry removes all entries", () => {
    registerConnector(testMeta, async () => ({}));
    expect(listConnectors()).toHaveLength(1);

    clearConnectorRegistry();
    expect(listConnectors()).toHaveLength(0);
  });
});

describe("CredentialStore", () => {
  beforeEach(() => {
    getCredentialStore().clear();
  });

  it("stores and retrieves credentials", () => {
    const store = getCredentialStore();
    store.set("feishu", { appId: "id", appSecret: "secret" });

    expect(store.get("feishu")).toEqual({ appId: "id", appSecret: "secret" });
    expect(store.has("feishu")).toBe(true);
  });

  it("returns undefined for missing credentials", () => {
    const store = getCredentialStore();
    expect(store.get("unknown")).toBeUndefined();
    expect(store.has("unknown")).toBe(false);
  });

  it("returns the same singleton instance", () => {
    const a = getCredentialStore();
    const b = getCredentialStore();
    expect(a).toBe(b);
  });
});
