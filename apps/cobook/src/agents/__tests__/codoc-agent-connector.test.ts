import { describe, it, expect, beforeEach } from "vitest";
import {
  registerConnector,
  clearConnectorRegistry,
  getCredentialStore,
} from "@codoc/core";
import type { ConnectorMeta } from "@codoc/core";
import { buildConnectorContext } from "../codoc-agent.js";

const testMeta: ConnectorMeta = {
  name: "feishu-table",
  displayName: "飞书多维表格",
  description: "从飞书多维表格拉取记录。",
  configSchema: {},
  authSchema: {},
  exampleYaml: `tasks:\n  $source:\n    connector: feishu-table\n    appToken: abc\n  ttl: 300`,
};

describe("buildConnectorContext", () => {
  beforeEach(() => {
    clearConnectorRegistry();
    getCredentialStore().clear();
  });

  it("returns empty string when no connectors registered", () => {
    expect(buildConnectorContext()).toBe("");
  });

  it("includes connector metadata when registered", () => {
    registerConnector(testMeta, async () => ({}));
    const result = buildConnectorContext();

    expect(result).toContain("飞书多维表格");
    expect(result).toContain("`feishu-table`");
    expect(result).toContain("从飞书多维表格拉取记录。");
    expect(result).toContain("connector: feishu-table");
  });

  it("shows auth status as not configured when no credentials", () => {
    registerConnector(testMeta, async () => ({}));
    const result = buildConnectorContext();

    expect(result).toContain("✗ not configured");
  });

  it("shows auth status as configured when credentials present", () => {
    registerConnector(testMeta, async () => ({}));
    getCredentialStore().set("feishu-table", { appId: "id", appSecret: "s" });
    const result = buildConnectorContext();

    expect(result).toContain("✓ configured");
    expect(result).not.toContain("✗ not configured");
  });

  it("lists multiple connectors", () => {
    registerConnector(testMeta, async () => ({}));
    const meta2: ConnectorMeta = {
      ...testMeta,
      name: "feishu-doc",
      displayName: "飞书文档",
      description: "从飞书文档拉取内容。",
    };
    registerConnector(meta2, async () => ({}));

    const result = buildConnectorContext();
    expect(result).toContain("飞书多维表格");
    expect(result).toContain("飞书文档");
  });
});
