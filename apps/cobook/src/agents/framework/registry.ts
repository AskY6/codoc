import type { SceneAgent, SceneAgentEntry } from "./types.js";

type Listener = () => void;
type Unsubscribe = () => void;

/**
 * Scene Agent Registry — manages registration, activation, and trust of scene agents.
 *
 * - Agents are registered but inactive by default
 * - Users activate/deactivate agents on demand
 * - Trusted agents' intents skip human review
 */
export class SceneAgentRegistry {
  private entries = new Map<string, SceneAgentEntry>();
  private listeners = new Set<Listener>();

  register(agent: SceneAgent): void {
    if (this.entries.has(agent.id)) {
      throw new Error(`Scene agent already registered: ${agent.id}`);
    }
    this.entries.set(agent.id, { agent, active: false });
    this.notify();
  }

  unregister(agentId: string): void {
    this.entries.delete(agentId);
    this.notify();
  }

  activate(agentId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) throw new Error(`Scene agent not found: ${agentId}`);
    if (entry.active) return;
    entry.active = true;
    this.notify();
  }

  deactivate(agentId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) throw new Error(`Scene agent not found: ${agentId}`);
    if (!entry.active) return;
    entry.active = false;
    this.notify();
  }

  setTrusted(agentId: string, trusted: boolean): void {
    const entry = this.entries.get(agentId);
    if (!entry) throw new Error(`Scene agent not found: ${agentId}`);
    entry.agent.trusted = trusted;
    this.notify();
  }

  get(agentId: string): SceneAgentEntry | undefined {
    return this.entries.get(agentId);
  }

  getAgent(agentId: string): SceneAgent | undefined {
    return this.entries.get(agentId)?.agent;
  }

  listAll(): SceneAgentEntry[] {
    return [...this.entries.values()];
  }

  listActive(): SceneAgent[] {
    return [...this.entries.values()]
      .filter((e) => e.active)
      .map((e) => e.agent);
  }

  listInactive(): SceneAgent[] {
    return [...this.entries.values()]
      .filter((e) => !e.active)
      .map((e) => e.agent);
  }

  isActive(agentId: string): boolean {
    return this.entries.get(agentId)?.active ?? false;
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
