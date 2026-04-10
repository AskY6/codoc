import { apiFetch } from "./client.js";
import type { GraphData } from "../types.js";

export function getGraph(workspaceId: string): Promise<GraphData> {
  return apiFetch(`/workspace/${workspaceId}/graph`);
}
