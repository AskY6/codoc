"use client";

import { useCallback, useSyncExternalStore } from "react";
import { SceneAgentStore } from "@/workspace/stores/scene-agent-store";
import type { SceneAgentView } from "@/workspace/stores/scene-agent-store";

// Singleton
const store = new SceneAgentStore();

export function getSceneAgentStore(): SceneAgentStore {
  return store;
}

const EMPTY_AGENTS: SceneAgentView[] = [];

export function useSceneAgents(): SceneAgentView[] {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getSceneAgents(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_AGENTS);
}

// --- API Actions ---

export async function activateSceneAgent(agentId: string): Promise<void> {
  const res = await fetch("/api/scene-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, action: "activate" }),
  });
  if (!res.ok) throw new Error(`Failed to activate agent: ${res.status}`);
  store.updateSceneAgent(agentId, { active: true });
}

export async function deactivateSceneAgent(agentId: string): Promise<void> {
  const res = await fetch("/api/scene-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, action: "deactivate" }),
  });
  if (!res.ok) throw new Error(`Failed to deactivate agent: ${res.status}`);
  store.updateSceneAgent(agentId, { active: false });
}

export async function setSceneAgentTrust(agentId: string, trusted: boolean): Promise<void> {
  const res = await fetch("/api/scene-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, action: "set-trust", trusted }),
  });
  if (!res.ok) throw new Error(`Failed to set trust: ${res.status}`);
  store.updateSceneAgent(agentId, { trusted });
}
