import type { Brand } from "@cobook/core";

/**
 * Branded identifier for a registered tool. Equal to a string at
 * runtime but distinct at the type level, so a `ToolId` cannot be
 * accidentally passed where a `NodeId` / `AgentId` is expected.
 */
export type ToolId = Brand<string, "ToolId">;

export const ToolId = (s: string): ToolId => s as ToolId;
