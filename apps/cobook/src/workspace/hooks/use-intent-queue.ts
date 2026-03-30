"use client";

import { useCallback, useSyncExternalStore } from "react";
import { IntentQueueStore } from "@/workspace/stores/intent-queue-store";
import type { IntentRecordView, SceneAgentView } from "@/workspace/stores/intent-queue-store";

// Singleton
const store = new IntentQueueStore();

export function getIntentQueueStore(): IntentQueueStore {
  return store;
}

// --- Intent Queue Hooks ---

const EMPTY_RECORDS: IntentRecordView[] = [];
const EMPTY_AGENTS: SceneAgentView[] = [];

export function useIntentRecords(): IntentRecordView[] {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getRecords(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_RECORDS);
}

export function usePendingIntentCount(): number {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getPendingCount(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

export function useSceneAgents(): SceneAgentView[] {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getSceneAgents(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_AGENTS);
}

// --- API Actions ---

export async function confirmIntent(intentId: string): Promise<void> {
  const res = await fetch("/api/intent-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intentId, action: "confirm" }),
  });
  if (!res.ok) throw new Error(`Failed to confirm intent: ${res.status}`);
}

export async function rejectIntent(intentId: string): Promise<void> {
  const res = await fetch("/api/intent-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intentId, action: "reject" }),
  });
  if (!res.ok) throw new Error(`Failed to reject intent: ${res.status}`);
}

export async function previewIntent(intentId: string): Promise<void> {
  const res = await fetch("/api/intent-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intentId, action: "preview" }),
  });
  if (!res.ok) throw new Error(`Failed to preview intent: ${res.status}`);
}

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
