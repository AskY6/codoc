// API client for /api/agents.

import type { AgentListItem } from "../types";
import { apiFetch } from "./client";

export function listAgents(): Promise<AgentListItem[]> {
  return apiFetch<AgentListItem[]>("/api/agents");
}
