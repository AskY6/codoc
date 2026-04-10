import { apiFetch } from "./client.js";
import type { BuildResult } from "../types.js";

export function triggerBuild(workspaceId: string): Promise<BuildResult> {
  return apiFetch(`/workspace/${workspaceId}/build`, { method: "POST" });
}

export function resolveNode(
  workspaceId: string,
  nodeId: string,
): Promise<{ nodeId: string; value: unknown }> {
  return apiFetch(`/workspace/${workspaceId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });
}
