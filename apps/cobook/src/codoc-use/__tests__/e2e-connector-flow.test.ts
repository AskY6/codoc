import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  Workspace,
  setDocRegistry,
  getDocRegistry,
  registerConnector,
  clearConnectorRegistry,
  getCredentialStore,
  clearSourceCache,
  scheduleForce,
} from "@codoc/core";
import type { ConnectorMeta } from "@codoc/core";
import { createChatAbility } from "../../chat/index.js";
import { initCodocUse } from "../index.js";

/**
 * E2E: Full conversational connector flow through chat layer.
 *
 * Tests:
 * 1. create-codoc intent with connector $source → connector called → field resolved → change event in chat
 * 2. Auth missing → field errors → auth guidance message in chat
 */

const mockConnectorFn = vi.fn();

const mockMeta: ConnectorMeta = {
  name: "test-api",
  displayName: "Test API",
  description: "Test connector",
  configSchema: {},
  authSchema: {},
  exampleYaml: "",
};

describe("E2E: Connector flow through chat", () => {
  let wsDir: string;
  let savedRegistry: ReturnType<typeof getDocRegistry>;

  beforeAll(async () => {
    savedRegistry = getDocRegistry();
  });

  afterAll(() => {
    if (savedRegistry) setDocRegistry(savedRegistry);
  });

  beforeEach(async () => {
    clearSourceCache();
    clearConnectorRegistry();
    getCredentialStore().clear();
    mockConnectorFn.mockReset();
    wsDir = await mkdtemp(join(tmpdir(), "codoc-chat-e2e-"));
  });

  afterEach(async () => {
    await rm(wsDir, { recursive: true, force: true });
  });

  it("create-codoc with connector → data resolved → workspace change event in chat", async () => {
    // Setup connector with credentials
    mockConnectorFn.mockResolvedValue([
      { task: "Design review", owner: "Alice" },
    ]);
    registerConnector(mockMeta, mockConnectorFn);
    getCredentialStore().set("test-api", { token: "secret" });

    // Create workspace + chat + wire everything
    const ws = await Workspace.create(wsDir);
    const chat = createChatAbility();
    const sessionId = chat.createSession();
    initCodocUse(ws, chat, sessionId);

    // Simulate agent proposing a create-codoc intent
    const yaml = `type:
  properties:
    tasks:
      type: array
data:
  tasks:
    $source:
      connector: test-api
      endpoint: /tasks
    ttl: 300
view: "# Tasks"`;

    const agentMsg = chat.sendMessage(sessionId, {
      sender: { id: "codoc-agent", kind: "agent" },
      content: "I'll create a tasks codoc with test-api connector.",
      intents: [
        {
          kind: "create-codoc",
          payload: { docId: "tasks.codoc", content: yaml },
          status: "proposed",
        },
      ],
    });

    // User confirms the intent
    chat.updateIntentStatus(sessionId, agentMsg.id, 0, "confirmed");

    // Wait for async intent execution
    await new Promise((r) => setTimeout(r, 100));

    // Verify: doc was created
    const meta = ws.getDocMeta("tasks.codoc");
    expect(meta).toBeDefined();
    expect(meta!.fields.some((f) => f.path === "/tasks")).toBe(true);

    // Load and observe the connector field
    const { tree, dag } = ws.loadDoc("tasks.codoc");
    const result = await scheduleForce(tree, dag);

    expect(result.resolved).toContain("/tasks");
    expect(mockConnectorFn).toHaveBeenCalledWith(
      { endpoint: "/tasks" },
      { token: "secret" },
    );

    const field = tree.getField("/tasks")!;
    expect(field.state.status).toBe("resolved");
    if (field.state.status === "resolved") {
      expect(field.state.value).toEqual([
        { task: "Design review", owner: "Alice" },
      ]);
    }

    // Wait for debounced workspace change events to flush into chat
    await new Promise((r) => setTimeout(r, 2500));

    const messages = chat.getMessages(sessionId);
    // There should be a system message about the field change
    const changeMsg = messages.find(
      (m) => m.sender.id === "system" && m.content.includes("/tasks"),
    );
    expect(changeMsg).toBeDefined();
  });

  it("auth missing → connector error → guidance message in chat", async () => {
    // Register connector but NO credentials
    mockConnectorFn.mockRejectedValue({
      kind: "source",
      message: "飞书认证未配置：缺少 appId 或 appSecret",
      retryable: false,
    });
    registerConnector(mockMeta, mockConnectorFn);

    const ws = await Workspace.create(wsDir);
    const chat = createChatAbility();
    const sessionId = chat.createSession();
    initCodocUse(ws, chat, sessionId);

    // Create codoc with connector that will fail
    const yaml = `type:
  properties:
    data:
      type: array
data:
  data:
    $source:
      connector: test-api
      endpoint: /secret
    ttl: 60
view: "# Data"`;

    await ws.createDoc("secret.codoc", yaml);
    const { tree } = ws.loadDoc("secret.codoc");

    // Observe will fail due to missing auth
    try {
      await tree.observe("/data");
    } catch {
      // Expected: connector throws auth error
    }

    // Wait for workspace change event to propagate to chat
    await new Promise((r) => setTimeout(r, 100));

    const messages = chat.getMessages(sessionId);

    // Should have an auth guidance message
    const guidanceMsg = messages.find(
      (m) =>
        m.sender.id === "system" &&
        m.content.includes("test-api") &&
        m.content.includes("credentials.yaml"),
    );
    expect(guidanceMsg).toBeDefined();
    expect(guidanceMsg!.content).toContain("认证");
  });
});
